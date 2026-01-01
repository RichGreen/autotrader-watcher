import { ApifyClient } from 'apify-client';
import crypto from 'crypto';

// ================= CONFIG =================
const SEARCH_URLS = [
  'https://www.autotrader.co.uk/car-search?make=Tesla&model=Model%20Y&postcode=E1%207DJ&radius=1500&sort=most-recent',
  'https://www.autotrader.co.uk/car-search?make=Tesla&minimum-seats=6&model=Model%20X&postcode=E1%207DJ&sort=most-recent&year-from=2020',
];

const ACTOR_ID = 'memo23/autotrader-cheerio';
const STORE_NAME = 'autotrader-watcher';
const MAX_ITEMS = 5;
// =========================================

// Create Apify client
const client = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

// Ensure KV store exists
const { id: storeId } = await client
  .keyValueStores()
  .getOrCreate(STORE_NAME);

const store = client.keyValueStore(storeId);

// Generate a stable KV-safe key per search URL
function searchKey(url) {
  return (
    'SEARCH_' +
    crypto.createHash('sha1').update(url).digest('hex').slice(0, 8)
  );
}

// ================= MAIN =================
const emailSections = [];
let foundAnyNewListings = false;

for (const url of SEARCH_URLS) {
  console.log('\n🔍 Checking search:');
  console.log(url);

  const key = searchKey(url);

  // Run scraper
  const run = await client.actor(ACTOR_ID).call({
    startUrls: [{ url }],
    maxItems: MAX_ITEMS,
    includeListingDetails: false,
    proxy: { useApifyProxy: true },
  });

  // Read dataset
  const { items } = await client
    .dataset(run.defaultDatasetId)
    .listItems();

  // Extract listing IDs
  const currentIds = items
    .map(item => item.url)
    .filter(Boolean)
    .map(u => u.split('/car-details/')[1]?.split('?')[0])
    .filter(Boolean)
    .sort();

  // Load seen IDs
  const record = await store.getRecord(key);
  const seenIds = record?.value ?? [];

  // Diff
  const newIds = currentIds.filter(id => !seenIds.includes(id));

  if (newIds.length === 0) {
    console.log('No new listings');
    emailSections.push(
      `Search:\n${url}\n\nNo new listings found.`
    );
  } else {
    foundAnyNewListings = true;

    console.log('NEW LISTINGS FOUND:');
    newIds.forEach(id => console.log(id));

    const links = newIds
      .map(id => `https://www.autotrader.co.uk/car-details/${id}`)
      .join('\n');

    emailSections.push(
      `Search:\n${url}\n\nNew listings:\n${links}`
    );
  }

  // Persist state
  await store.setRecord({
    key,
    value: Array.from(new Set([...seenIds, ...currentIds])),
  });
}

// ================= EMAIL =================
const subject = foundAnyNewListings
  ? '🚗 NEW AutoTrader listings found'
  : '✅ AutoTrader check ran – no new listings';

const body = emailSections.join('\n\n--------------------\n\n');

async function sendEmail(subject, body) {
  await client.user().sendNotification({
    type: 'EMAIL',
    subject,
    message: body,
  });
}


console.log('📧 Email sent successfully');
