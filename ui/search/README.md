# Oryn search behavior

Oryn does not run a search backend, scrape result pages, or call a search API. A user-entered query is resolved locally:

- an `http://` or `https://` URL opens directly;
- a recognized domain is opened as HTTPS;
- normal text is sent to the selected provider URL from Settings.

Supported built-in providers are Google, DuckDuckGo, Bing, and Brave Search. A custom HTTPS template may use `{query}` once. Oryn does not prefetch searches or automatically retry failed searches, so provider bot protection remains the provider's responsibility.
