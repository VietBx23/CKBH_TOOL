// server.js
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const pLimit = require('p-limit').default;

const app = express();
const PORT = 3000;
const CONCURRENCY = 10;
const limit = pLimit(CONCURRENCY);

// Danh sách 6 nguồn
const SOURCES = [
  { id: 56, base: 'https://ckbh.vip' },
  { id: 21, base: 'https://ckbh.vip' },
  { id: 23, base: 'https://ckbh.vip' },
  { id: 29, base: 'https://ckbh.vip' },
  { id: 40, base: 'https://ckbh.vip' },
  { id: 50, base: 'https://ckbh.vip' },
];

// Hàm scrape danh sách video theo source và page
async function scrapePage(source, page = 1) {
  const url = `${source.base}/index.php/vod/type/id/${source.id}/page/${page}.html`;
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': source.base }
  });

  const $ = cheerio.load(data);
  const results = [];

  $('ul li').each((i, li) => {
    const a = $(li).find('a.videoName');
    if (!a.length) return;
    results.push({
      title: a.text().trim(),
      link: source.base + a.attr('href')
    });
  });

  return results;
}

// Hàm scrape chi tiết video: cover + m3u8
async function scrapeDetail(source, bookUrl) {
  const { data } = await axios.get(bookUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': source.base }
  });
  const $ = cheerio.load(data);

  const img = $('div.left img').attr('src');
  const cover = img ? source.base + img : null;

  const episodes = [];
  $('font[color="red"]').each((i, el) => {
    const text = $(el).text().trim();
    const [_, link] = text.split('$');
    if (link) episodes.push(link);
  });

  return { cover, episodes };
}

// Endpoint crawl từng page theo sourceId
app.get('/api/crawl/:sourceId', async (req, res) => {
  const sourceId = parseInt(req.params.sourceId);
  const page = parseInt(req.query.page) || 1;
  const source = SOURCES.find(s => s.id === sourceId);

  if (!source) return res.status(400).json({ error: 'Nguồn không tồn tại' });

  try {
    const list = await scrapePage(source, page);

    // Crawl chi tiết từng video với concurrency cao
    const results = await Promise.all(
      list.map(book => limit(() =>
        scrapeDetail(source, book.link).then(detail => ({
          title: book.title,
          link: book.link,
          cover: detail.cover,
          episodes: detail.episodes
        }))
      ))
    );

    res.json({ source: source.id, page, total: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📌 Endpoints available:`);
  SOURCES.forEach(s => console.log(`   /api/crawl/${s.id}?page=1`));
});
