# Contentful Source


## ContentfulOptions Parameters
| Property | Type | Description |
| - | - | - |
| <a name="module_contentful-source.ContentfulOptions+space">`space`</a> |  <code>string</code>| Your Contentful space ID. Note that credentials.json will require an accessToken in addition to this |
| <a name="module_contentful-source.ContentfulOptions+locale">`locale`</a> |  <code>string</code>| Optional. Used to pull localized images. Defaults to &#x27;en-US&#x27; |
| <a name="module_contentful-source.ContentfulOptions+filename">`filename`</a> |  <code>string</code>| Optional. The filename you want to use for where all content (entries and assets metadata) will be stored. Defaults to &#x27;content.json&#x27; |
| <a name="module_contentful-source.ContentfulOptions+contentTypes">`contentTypes`</a> |  <code>Array.&lt;string&gt;</code>| Optionally limit queries to these content types.<br>This will also apply to linked assets.<br>Types that link to other types will include up to 10 levels of child content.<br>E.g. filtering by Story, might also include Chapters and Images.<br>Uses searchParams[&#x27;sys.contentType.sys.id[in]&#x27;] under the hood. |
| <a name="module_contentful-source.ContentfulOptions+searchParams">`searchParams`</a> |  <code>Object</code>| Optional. Supports anything from https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/search-parameters |
| <a name="module_contentful-source.ContentfulOptions+imageParams">`imageParams`</a> |  <code>Object</code>| Optional. Applies to all images. Defaults to empty object.<br>IMPORTANT: If you change the parameters, you will have to<br>delete all cached images since the modified date of the<br>original image will not have changed. |
| <a name="module_contentful-source.ContentfulOptions+protocol">`protocol`</a> |  <code>string</code>| Optional. Defaults to &#x27;https&#x27;. |
| <a name="module_contentful-source.ContentfulOptions+host">`host`</a> |  <code>string</code>| Optional. Defaults to &#x27;cdn.contentful.com&#x27;. |
| <a name="module_contentful-source.ContentfulOptions+usePreviewApi">`usePreviewApi`</a> |  <code>boolean</code>| Optional. Set to true if you want to use the preview API instead of the production version to view draft content. Defaults to false. |
| <a name="module_contentful-source.ContentfulOptions+deliveryToken">`deliveryToken`</a> |  <code>string</code>| Content delivery token (all published content). |
| <a name="module_contentful-source.ContentfulOptions+previewToken">`previewToken`</a> |  <code>string</code>| Content preview token (only unpublished/draft content). |
| <a name="module_contentful-source.ContentfulOptions+accessToken">`accessToken`</a> |  <code>string</code>| LEGACY: For backwards compatibility you can only set the &quot;accessToken&quot; using your delivery or preview token and a combination of the usePreviewApi flag. |
