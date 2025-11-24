// server.js
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const pLimit = require('p-limit').default;

const app = express();
const PORT = 3000;

const BASE = 'https://ckbh.vip';
const CONCURRENCY = 10; // tăng concurrency
const limit = pLimit(CONCURRENCY);

// Lấy danh sách truyện từ 1 page
async function scrapePage(page = 1) {
  const url = `${BASE}/index.php/vod/type/id/56/page/${page}.html`;
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': BASE }
  });

  const $ = cheerio.load(data);
  const results = [];

  $('ul li').each((i, li) => {
    const a = $(li).find('a.videoName');
    if (!a.length) return;
    const title = a.text().trim();
    const href = BASE + a.attr('href');
    results.push({ title, link: href });
  });

  return results;
}

// Lấy chi tiết truyện: ảnh + link m3u8
async function scrapeDetail(bookUrl) {
  const { data } = await axios.get(bookUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': BASE }
  });
  const $ = cheerio.load(data);

  // Ảnh cover
  const img = $('div.left img').attr('src');
  const cover = img ? BASE + img : null;

  // Các tập: tìm font color red
  const episodes = [];
  $('font[color="red"]').each((i, el) => {
    const text = $(el).text().trim();
    const [ep, link] = text.split('$');
    if (link) episodes.push(link); // chỉ lấy link m3u8
  });

  return { cover, episodes };
}

// API endpoint
app.get('/api/crawl', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  try {
    const list = await scrapePage(page);

    // Crawl chi tiết từng truyện **song song với concurrency cao**
    const results = await Promise.all(
      list.map(book => limit(() =>
        scrapeDetail(book.link).then(detail => ({
          title: book.title,
          link: book.link,
          cover: detail.cover,
          episodes: detail.episodes
        }))
      ))
    );

    res.json({ page, total: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
