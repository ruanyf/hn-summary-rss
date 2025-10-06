import Parser from 'rss-parser';
import { Feed } from 'feed';
import process from 'node:process';
import fs from 'node:fs/promises'; 

/*
** Varible Settings **
*/

const apiKey = process.env.ZHIPU_API_KEY || 'your-api-key-here';

if (apiKey === 'your-api-key-here') {
  console.error('请设置有效的API密钥！');
  console.log('1. 设置环境变量: export ZHIPU_API_KEY="your-actual-api-key"');
  console.log('2. 或在代码中直接设置apiKey变量');
  process.exit(1);
}

const FeedArray = [
  'https://hnrss.org/frontpage',
  'https://hnrss.org/newest',
];

// const FeedUrl = 'https://feeds.feedburner.com/xda-developers/ShsH';
const FeedUrl = FeedArray[(new Date()).getSeconds() % 2];
// console.log(FeedUrl);

const myFeed = new Feed({
  title: "Hacker News 中文摘要 Feed",
  description: "Hacker News 文章链接的中文摘要",
  id: "https://hn.wangbase.com",
  link: "https://hn.wangbase.com",
  language: "zh-CN", // optional, used only in RSS 2.0, possible values: http://www.w3.org/TR/REC-html40/struct/dirlang.html#langcodes
  // image: "http://example.com/image.png",
  // favicon: "http://example.com/favicon.ico",
  // copyright: "All rights reserved 2013, John Doe",
  updated: new Date(), // optional, default = today
  // generator: "awesome", // optional, default = 'Feed for Node.js'
  feedLinks: {
    json: "https://hn.wangbase.com/rss.json",
    atom: "https://hn.wangbase.com/rss.xml"
  },
  author: {
    name: "ruanyf",
    email: "yifeng.ruan@gmail.com",
    link: "https://www.ruanyifeng.com/blog"
  }
});


let LLMApi = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

let LLMHeader = {
  "Authorization": 'Bearer ' + apiKey,
  "Content-Type": 'application/json',
};

let LLMData = {
  "model": "glm-4.5-airx",
  "messages": [
    {
      "role": "system",
      "content": "你是一个有用的AI助手。"
    },
    {
      "role": "user",
      "content": ""
    }
  ],
  "temperature": 1,
  "max_tokens": 65536,
  "stream": false,
};

/*
** 读取 RSS **
*/

let parser = new Parser({  
  timeout: 9000,
  headers: {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15'},
  maxRedirects: 10,
  defaultRSS: 2.0,
});

async function feedParser(feedUrl) {
  console.log('begin fetching HN feed...');
  let hnFeed = await parser.parseURL(feedUrl);
  console.log('successfully fetch HN feed');

  hnFeed.items.forEach(item => {
    // console.log(item);
    myFeed.addItem({
      title: item.title,
      id: item.link,
      link: item.link,
      content: '',
      comments: item.comments,
      date: new Date(item.pubDate),
    });
    // console.log(item.title + ':' + item.link)
  });
}

/*
 * 写入文件 *
 */

async function feedToFile() {
  if (!myFeed.items || !myFeed.items.length) return;
  // console.log(myFeed.items[1]);
  await fs.rm('./dist', { recursive: true, force: true });
  console.log('successfully delete dist directory');
  await fs.mkdir('./dist');
  console.log('successfully make dist directory');
  await fs.writeFile('./dist/rss.json', myFeed.json1());
  console.log('successfully write rss.json');
  await fs.writeFile('./dist/rss.xml', myFeed.rss2());
  console.log('successfully write rss.xml');
  await fs.copyFile('./template/index.html', `./dist/index.html`);
  await fs.copyFile('./template/page.js', `./dist/page.js`);
  console.log(`successfully copy asset files`);
} 

/*
 * AI 内容总结 *
 */

async function aiSummary() {
  if (!myFeed.items || !myFeed.items.length) return;

  console.log('begin AI summary. It takes time...');
  
  const linkArray = [];
  myFeed.items.forEach(item => linkArray.push({title: item.title, link: item.link}));
  // console.log(JSON.stringify(linkArray));

  LLMData.messages[1].content = '后面是一个 JSON 数组，每个数组成员是一个对象，包括 title 和 link 两个字段。你将 title 字段翻译成中文，并抓取 link 字段的网址，生成该网址的中文内容总结，每个总结长度不要超过300字，再将总结添加到该对象的 summary 字段。最后，以 JSON 格式返回所有内容，不要返回其他内容，也不要放在 json 代码块里面，并在返回前检查这个 JSON 格式的字符串，确保它能被 JavaScript 语言的 JSON.parse() 正确解析。 ' + JSON.stringify(linkArray);

    const response = await fetch(LLMApi, {
      method: 'POST',
      headers: LLMHeader,
      body: JSON.stringify(LLMData),
    });
    const data = await response.json();

    if (!(data?.choices[0]?.message?.content)) throw new Error('wrong AI response.');
    console.log(data.choices[0].message.content);

    let result = sterilizeJSON(data.choices[0].message.content);
    result = JSON.parse(result);
 
    for (let i = 0; i < result.length; i++) {
      const item = myFeed.items[i];
      item.title = result[i].title; 
      item.content = result[i].summary + ' [<a href="' + item.comments + '" target="_blank">评论</a>]';
    }

    console.log('successfully AI summarize the content');
  
}

function sterilizeJSON(str) {
  let newStr = str;
  newStr = newStr
    .replaceAll('"title"', 'titleTAG')
    .replaceAll('"summary"', 'summaryTAG')
    .replaceAll('"link_summary"', 'summaryTAG')
    .replaceAll('"link_content"', 'summaryTAG')
    .replaceAll('"content"', 'summaryTAG')
    .replaceAll('"link"', 'linkTAG')
    .replaceAll(':"', 'quoteBEGIN')
    .replaceAll(': "', 'quoteBEGIN')
    .replaceAll('："', 'quoteBEGIN')
    .replaceAll('： "', 'quoteBEGIN')
    .replaceAll('"}', 'quoteBracesEND')
    .replaceAll(/"\s+}/g, 'quoteBracesEND')
    .replaceAll('",', 'quoteCommaEND')
    .replaceAll('"，', 'quoteCommaEND')
    .replaceAll(/"\s+,/g, 'quoteCommaEND')
    .replaceAll('"', '“')
    .replaceAll('quoteCommaEND', '",')
    .replaceAll('quoteBracesEND', '"}')
    .replaceAll('quoteBEGIN', ':"')
    .replaceAll('linkTAG', '"link"')
    .replaceAll('summaryTAG', '"summary"')
    .replaceAll('titleTAG', '"title"');
  return newStr;
}

/*
 * 主流程 *
 */

async function main() {
  await feedParser(FeedUrl);
  await aiSummary();
  await feedToFile();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

