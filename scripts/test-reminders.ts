import 'dotenv/config';
import { createAccount, getBasicAuthHeaders } from 'tsdav';

async function main() {
  const username = process.env.ICLOUD_USERNAME;
  const password = process.env.ICLOUD_APP_PASSWORD;

  if (!username || !password) {
    console.error('Missing ICLOUD_USERNAME or ICLOUD_APP_PASSWORD in .env');
    process.exit(1);
  }

  console.log(`Connecting as: ${username}`);
  console.log('---');

  const headers = getBasicAuthHeaders({ username, password });

  const account = await createAccount({
    account: {
      serverUrl: 'https://caldav.icloud.com',
      accountType: 'caldav',
      credentials: { username, password },
    },
    headers,
    loadCollections: true,
    loadObjects: false,
  });

  console.log('homeUrl:', account.homeUrl);
  console.log('principalUrl:', account.principalUrl);
  console.log('---');

  const calendars = account.calendars ?? [];
  console.log(`Total calendars found: ${calendars.length}`);
  console.log('---');

  for (const cal of calendars) {
    console.log(`Name:       ${cal.displayName ?? '(no name)'}`);
    console.log(`URL:        ${cal.url}`);
    console.log(`Components: ${JSON.stringify(cal.components)}`);
    console.log('---');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
