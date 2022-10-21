# Example: JSON Content Source

The `json` content source type can fetch mulitple json files via HTTP, store them locally with a custom filename and parse them for URLs to download (defaults to images and videos).

The following `launchpad.json` would download jsons and images from the Flickr API to `.downloads/flickr-images` (a combination of the default `.downloads/` directory and the `id` field of the content source):

```json
{
  "content": {
    "sources": [
      {
        "id": "flickr-images",
        "type": "json",
        "files": {
            "spaceships.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=spaceship",
            "rockets.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=rocket"
        }
      }
    ]
  }
}
```

Each API request will be stored as an individual `json`:
- `.downloads/flickr-images/spaceships.json`
- `.downloads/flickr-images/rockets.json`

All images contained in these json files will be downloaded while retaining the remote directory structure. So `https://live.staticflickr.com/65535/51886202435_e49e7ef884_m.jpg` would be downloaded to `.downloads/65535/51886202435_e49e7ef884_m.jpg`.
