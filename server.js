const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const pLimit = require('p-limit').default;

const app = express();
const PORT = 3000;
const CONCURRENCY = 10;
const limit = pLimit(CONCURRENCY);
const BASE_URL = 'https://ckbh.vip';

// Danh sách 6 nguồn
const SOURCES = [
  { id: 56, base: 'https://ckbh.vip' },
  { id: 21, base: 'https://ckbh.vip' },
  { id: 23, base: 'https://ckbh.vip' },
  { id: 29, base: 'https://ckbh.vip' },
  { id: 40, base: 'https://ckbh.vip' },
  { id: 50, base: 'https://ckbh.vip' },
];

// ----------------------------------------
// Hàm scrape danh mục nav (cha + con)
async function scrapeNav() {
  try {
    const { data } = await axios.get(BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': BASE_URL
      }
    });

    const $ = cheerio.load(data);
    const navs = [];
    let currentParent = null;

    $('.nav ul li a').each((i, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr('href') || '';
      const match = href.match(/id\/(\d+)/);
      const id = match ? parseInt(match[1]) : null;

      if (!id) {
        // Là cha
        currentParent = { name, children: [] };
        navs.push(currentParent);
      } else if (currentParent) {
        // Là con
        currentParent.children.push({ id, name });
      }
    });

    // Sắp xếp con theo id tăng dần
    navs.forEach(parent => {
      parent.children.sort((a, b) => a.id - b.id);
    });

    return navs;
  } catch (err) {
    console.error('❌ Error:', err.message);
    return [];
  }
}


// ----------------------------------------
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

// Hàm scrape chi tiết video: cover + episodes
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

// ----------------------------------------
// API lấy danh mục nav
app.get('/api/nav', async (req, res) => {
  try {
    const navs = await scrapeNav();
    res.json({ totalParents: navs.length, categories: navs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API crawl video theo sourceId
app.get('/api/crawl/:sourceId', async (req, res) => {
  const sourceId = parseInt(req.params.sourceId);
  const page = parseInt(req.query.page) || 1;
  const source = SOURCES.find(s => s.id === sourceId);

  if (!source) return res.status(400).json({ error: 'Nguồn không tồn tại' });

  try {
    const list = await scrapePage(source, page);

    const results = await Promise.all(
      list.map(book =>
        limit(() =>
          scrapeDetail(source, book.link).then(detail => ({
            title: book.title,
            link: book.link,
            cover: detail.cover,
            episodes: detail.episodes
          }))
        )
      )
    );

    res.json({ source: source.id, page, total: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📌 Endpoints available:`);
  SOURCES.forEach(s => console.log(`   /api/crawl/${s.id}?page=1`));
  console.log(`   /api/nav`);
});
