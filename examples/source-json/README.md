The following `launchpad.json` would download content from the Flickr API. Content would be downloaded into `.downloads/spaceships` (based on the default `.downloads/` directory and the `id` field of the content source).

Each API request will be stored as an individual `json`:
- `.downloads/spaceships/spaceships.json`
- `.downloads/spaceships/rockets.json`

All images contained in these json files will be downloaded while retaining the remote directory structure. So `https://live.staticflickr.com/65535/51886202435_e49e7ef884_m.jpg` would be downloaded to `.downloads/65535/51886202435_e49e7ef884_m.jpg`.
