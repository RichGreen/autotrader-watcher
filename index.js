import { Actor } from 'apify';
import crypto from 'crypto';

await Actor.init();

// ================= CONFIG =================
const SEARCH_URLS = [
  // Tesla Model Y
  'https://www.autotrader.co.uk/car-search?make=Tesla&model=Model%20Y&postcode=E1%207DJ&radius=1500&sort=most-recent',

  // Tesla Model X (6+ seats, 2020+)
  'https://www.autotrader.co.uk/car-search?make=Tesla&minimum-seats=6&model=Model%20X&postcode=E1%207DJ&sort=most-recent&year-from=2020',
];

const SCRAPER_ACTOR_ID = 'memo23/autotrader-cheerio';
const MAX_ITEMS = 5;
// =========================================

// Open this actor’s default KV store
const store = await Actor.openKeyValueStore();

// Stable per-search key
function searchKey(url) {
  return (
    'SEARCH_' +
    crypto.createHash('sha1').update(url).digest('hex').slice(0, 8)
  );
}

let foundAnyNewListings = false;
const summaryLines = [];

// ================= MAIN =================
for (const url of SEARCH_URLS) {
  console.log('\n🔍 Checking search:');
  console.log(url);

  const key = searchKey(url);

  // Call the AutoTrader scraper actor
  const run = await Actor.call(SCRAPER_ACTOR_ID, {
    startUrls: [{ url }],
    maxItems: MAX_ITEMS,
    includeListingDetails: false,
    proxy: { useApifyProxy: true },
  });

  // Read dataset
  const { items } = await Actor.apifyClient
    .dataset(run.defaultDatasetId)
    .listItems();

  // Extract AutoTrader listing IDs
  const currentIds = items
    .map(item => item.url)
    .filter(Boolean)
    .map(u => u.split('/car-details/')[1]?.split('?')[0])
    .filter(Boolean)
    .sort();

  const seenIds = (await store.getValue(key)) ?? [];
  const newIds = currentIds.filter(id => !seenIds.includes(id));

  if (newIds.length === 0) {
    console.log('No new listings');
    summaryLines.push(`Search:\n${url}\n\nNo new listings.`);
  } else {
    foundAnyNewListings = true;

    console.log('NEW LISTINGS FOUND:');
    newIds.forEach(id => console.log(id));

    const links = newIds
      .map(id => `https://www.autotrader.co.uk/car-details/${id}`)
      .join('\n');

    summaryLines.push(
      `Search:\n${url}\n\nNew listings:\n${links}`
    );
  }

  // Persist updated state
  await store.setValue(
    key,
    Array.from(new Set([...seenIds, ...currentIds]))
  );
}

// Final log — Scheduler emails THIS output
console.log('\n====================');
console.log(
  foundAnyNewListings
    ? '🚗 NEW AutoTrader listings found'
    : '✅ No new AutoTrader listings'
