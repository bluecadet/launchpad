# Contentful Source


## ContentfulOptions Parameters
Configuration options for the Contentful ContentSource.

Also supports all fields of the Contentful SDK&#x27;s config.
| Property | Type | Default | Description |
| - | - | - | - |
| <a name="module_contentful-source.ContentfulOptions+space">`space`</a> |  <code>string</code>| <code>''</code>   | Your Contentful space ID. Note that credentials.json will require an accessToken in addition to this |
| <a name="module_contentful-source.ContentfulOptions+locale">`locale`</a> |  <code>string</code>| <code>'en-US'</code>   | Optional. Used to pull localized images. |
| <a name="module_contentful-source.ContentfulOptions+filename">`filename`</a> |  <code>string</code>| <code>'content.json'</code>   | Optional. The filename you want to use for where all content (entries and assets metadata) will be stored. |
| <a name="module_contentful-source.ContentfulOptions+contentTypes">`contentTypes`</a> |  <code>Array.&lt;string&gt;</code>| <code></code>   | Optionally limit queries to these content types.<br>This will also apply to linked assets.<br>Types that link to other types will include up to 10 levels of child content.<br>E.g. filtering by Story, might also include Chapters and Images.<br>Uses searchParams['sys.contentType.sys.id[in]'] under the hood. |
| <a name="module_contentful-source.ContentfulOptions+searchParams">`searchParams`</a> |  <code>Object</code>| <code></code>   | Optional. Supports anything from https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/search-parameters |
| <a name="module_contentful-source.ContentfulOptions+imageParams">`imageParams`</a> |  <code>Object</code>| <code></code>   | Optional. Applies to all images. Defaults to empty object.<br>IMPORTANT: If you change the parameters, you will have to<br>delete all cached images since the modified date of the<br>original image will not have changed. |
| <a name="module_contentful-source.ContentfulOptions+protocol">`protocol`</a> |  <code>string</code>| <code>'https'</code>   | Optional |
| <a name="module_contentful-source.ContentfulOptions+host">`host`</a> |  <code>string</code>| <code>'cdn.contentful.com'</code>   | Optional |
| <a name="module_contentful-source.ContentfulOptions+usePreviewApi">`usePreviewApi`</a> |  <code>boolean</code>| <code>false</code>   | Optional. Set to true if you want to use the preview API instead of the production version to view draft content. |
| <a name="module_contentful-source.ContentfulOptions+deliveryToken">`deliveryToken`</a> |  <code>string</code>| <code></code>   | Content delivery token (all published content). |
| <a name="module_contentful-source.ContentfulOptions+previewToken">`previewToken`</a> |  <code>string</code>| <code></code>   | Content preview token (only unpublished/draft content). |
| <a name="module_contentful-source.ContentfulOptions+accessToken">`accessToken`</a> |  <code>string</code>| <code></code>   | LEGACY: For backwards compatibility you can only set the "accessToken" using your delivery or preview token and a combination of the usePreviewApi flag. |
