/* eslint-disable quotes */
/* eslint-disable quote-props */
const config = {
	"logging": {
		"level": "debug"
	},
	"imageTransforms": [
		{ "scale": 2.0 },
		{ "scale": 0.5 },
		{ "scale": 0.25 }
	],
	"contentTransforms": {
		"$..body": ["mdToHtml"]
	},
	"sources": [
		{
			"id": "dummyjson",
			"type": "json",
			"files": {
				"photos.json": "https://dummyjson.com/products?limit=10"
			}
		}
		// {
		// 	"id": "spaceships",
		// 	"type": "json",
		// 	"files": {
		// 		"spaceships.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=spaceship",
		// 		"rockets.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=rocket"
		// 	},
		// 	"strip": "services/feeds/",
		// 	"imageTransforms": [
		// 		{ "scale": 0.75 }
		// 	]
		// }
		// {
		//   "id": "astronauts",
		//   "files": {
		//     "astronauts.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=astronauts"
		//   },
		//   "strip": "services/feeds/"
		// },
		// {
		//   "id": "strapiTest",
		//   "type": "strapi",
		//   "version": 3,
		//   "baseUrl": "http:localhost:1337/",
		//   "queries": ["poems"],
		//   "limit": 100,
		//   "maxNumPages": -1,
		//   "pageNumZeroPad": 0,
		// },
		// {
		//   "id": "contentfulTest",
		//   "type": "contentful",
		//   "space": "qc670l0h4zjf",
		//   "locale": "en-US",
		//   "filename": "content.json",
		//   "protocol": "https",
		//   "searchParams": {
		//     "limit": 1000,
		//     "include": 10
		//   },
		//   "contentTypes": [],
		//   "imageParams": {
		//     "f": "face",
		//     "fit": "crop",
		//     "w": 512,
		//     "h": 512
		//   }
		// },
		// {
		//   "id": "airtableTest",
		//   "type": "airtable",
		//   "baseId": "apppsX7HeYHO7rMjd",
		//   "defaultView": "Grid view",
		//   "tables": ["data"],
		//   "keyValueTables": ["settings"],
		//   "appendLocalAttachmentPaths": true,
		// }
	]
};

export default config;
