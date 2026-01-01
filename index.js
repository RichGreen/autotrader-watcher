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

// Open default KV store for this Actor
const store = await Actor.openKeyValueStore();

// Generate a stable KV key per search URL
function searchKey(url) {
  return (
    'SEARCH_' +
    crypto.createHash('sha1').update(url).digest('hex').slice(0, 8)
  );
}

let foundAnyNewListings = false;
const summaryLines = [];

// ================= MAIN LOOP =================
for (const url of SEARCH_URLS) {
  console.log('\n🔍 Checking search:');
  console.log(url);

  const key = searchKey(url);

  // Run the AutoTrader scraper actor
  const run = await Actor.call(SCRAPER_ACTOR_ID, {
    startUrls: [{ url }],
    maxItems: MAX_ITEMS,
    includeListingDetails: false,
    proxy: { useApifyProxy: true },
  });

  // Read dataset items
  const datasetClient = Actor.apifyClient.dataset(run.defaultDatasetId);
  const { items } = await datasetClient.listItems();

  // Extract stable AutoTrader listing IDs
  const currentIds = items
    .map(item => item.url)
    .filter(Boolean)
    .map(url => {
      const parts = url.split('/car-details/');
      if (parts.length < 2) return null;
      return parts[1].split('?')[0];
    })
    .filter(Boolean)
    .sort();

  // Load previously seen IDs for this search
  const seenIds = (await store.getValue(key)) || [];

  // Detect new listings
  const newIds = currentIds.filter(id => !seenIds.includes(id));

  if (newIds.length === 0) {
    console.log('No new listings');
    summaryLines.push(
      `Search:\n${url}\n\nNo new listings.`
    );
  } else {
    foundAnyNewListings = true;

    console.log('NEW LISTINGS FOUND:');
    for (const id of newIds) {
      console.log(id);
    }

    const links = newIds
      .map(id => `https://www.autotrader.co.uk/car-details/${id}`)
      .join('\n');

    summaryLines.push(
      `Search:\n${url}\n\nNew listings:\n${links}`
    );
  }

  // Persist updated state for this search
  const updatedIds = Array.from(new Set([...seenIds, ...currentIds]));
  await store.setValue(key, updatedIds);
}

// ================= FINAL OUTPUT =================
console.log('\n====================');

if (foundAnyNewListings) {
  console.log('🚗 NEW AutoTrader listings found');
} else {
  console.log('✅ No new AutoTrader listings');
}

console.log(summaryLines.join('\n\n--------------------\n\n'));

await Actor.exit();
