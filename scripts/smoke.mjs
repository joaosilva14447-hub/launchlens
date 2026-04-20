const apiKey = process.env.BIRDEYE_API_KEY;

if (!apiKey) {
  console.error("Missing BIRDEYE_API_KEY in the environment.");
  process.exit(1);
}

const response = await fetch("https://public-api.birdeye.so/defi/networks", {
  headers: {
    accept: "application/json",
    "X-API-KEY": apiKey
  }
});

const payload = await response.json();

if (!response.ok || payload.success === false) {
  console.error("Birdeye smoke test failed:", payload);
  process.exit(1);
}

console.log("Birdeye smoke test ok. Supported networks:", payload.data?.join(", "));

