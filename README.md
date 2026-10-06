# Gold & Silver

Live gold and silver spot prices from the [Metals.Dev](https://metals.dev/docs) API.

## Setup

1. Create an API key on the Metals.Dev dashboard.
2. Copy the example env file and add the key:

```bash
cp .env.example .env.local
```

```bash
METALS_API_KEY=your_key_here
```

3. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The API key stays on the server. The page loads gold and silver spot prices (bid, ask, high, low, and change), refreshes every 60 seconds, and can show USD, INR, and other currencies per troy ounce, gram, or 10 grams.
