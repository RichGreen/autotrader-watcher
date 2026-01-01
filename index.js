import { ApifyClient } from 'apify-client';
import crypto from 'crypto';

// ================= CONFIG =================
const SEARCH_URLS = [
  // Tesla Model Y
  'https://www.autotrader.co.uk/car-search?make=Tesla&model=Model%20Y&postcode=E1%207DJ&radius=1500&sort=most-recent',

  // Tesla Model X (6+ seats, 2020+)
  'https://www.autotrader.co.uk/car-search?make=Tesla&minimum-seats=6&model=Model%20X&postcode=E1%207DJ&sort=most-recent&year-from=2020',
];

const ACTOR_ID = 'epctex/autotradercouk-scraper';
const STORE_NAME = 'autotrader-watcher';
const MAX_ITEMS = 5;
// =========================================

// Create Apify client (external orchestration)
const client = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

// Ensure KV store exists and CAPTURE ID
const { id: storeId } = await client
  .keyValueStores()
  .getOrCreate(STORE_NAME);

// Always address the store by ID
const store = client.keyValueStore(storeId);

// Generate a stable, KV-safe key per search URL
function searchKey(url) {
  return (
    'SEARCH_' +
    crypto.createHash('sha1').update(url).digest('hex').slice(0, 8)
  );
}

// ================= MAIN LOOP =================
for (const url of SEARCH_URLS) {
  console.log('\n🔍 Checking search:');
  console.log(url);

  const key = searchKey(url);

  // 1. Run AutoTrader scraper for THIS URL
  const run = await client.actor(ACTOR_ID).call({
    startUrls: [url],
    maxItems: MAX_ITEMS,
    proxy: { useApifyProxy: true },
  });

  // 2. Read scraped results
  const { items } = await client
    .dataset(run.defaultDatasetId)
    .listItems();

  // 3. Extract stable AutoTrader listing IDs
  const currentIds = items
    .map(item => item.url)
    .filter(Boolean)
    .map(u => u.split('/car-details/')[1]?.split('?')[0])
    .filter(Boolean)
    .sort();

  // 4. Load previously seen IDs FOR THIS SEARCH
  const record = await store.getRecord(key);
  const seenIds = record?.value ?? [];

  // 5. Detect new listings
  const newIds = currentIds.filter(id => !seenIds.includes(id));

  // 6. Output
  if (newIds.length === 0) {
    console.log('No new listings');
  } else {
    console.log('NEW LISTINGS FOUND:');
    newIds.forEach(id => console.log(id));
  }

  // 7. Persist updated state FOR THIS SEARCH
  await store.setRecord({
    key,
    value: Array.from(new Set([...seenIds, ...currentIds])),
  });
}
