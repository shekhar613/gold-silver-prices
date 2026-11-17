# Gold & Silver

Live MCX gold and silver futures from [Angel One SmartAPI](https://smartapi.angelone.in/docs).

The page follows the front-month GOLD, Gold Mini, SILVER, and Silver Mini contracts. Gold is shown per 10 grams and silver per kg, with the day’s open, high, low, previous close, and best bid/ask. 24K, 22K, 18K, and 14K figures are the metal value scaled from the gold future (995 fine).

## Setup

1. Create an app at [smartapi.angelone.in/new/apps](https://smartapi.angelone.in/new/apps) and copy the API key. A redirect URL such as `http://localhost:3000` satisfies the form; login uses your client code, PIN, and authenticator secret.
2. Copy the example env file and fill it in:

```bash
cp .env.example .env.local
```

```bash
ANGEL_API_KEY=your_api_key
ANGEL_CLIENT_CODE=your_client_code
ANGEL_PIN=your_trading_pin
ANGEL_TOTP_SECRET=your_authenticator_secret
```

`ANGEL_TOTP_SECRET` is the base32 setup key from Angel One’s authenticator, not the 6-digit code that changes every 30 seconds.

3. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Credentials stay on the server. The board asks SmartAPI for a full quote about every 5 seconds while the tab is visible. A session lasts until Angel One expires it, then the server logs in again.
