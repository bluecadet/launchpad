# Contentful Source


## ContentfulOptions Parameters
| Property | Type | Description |
| - | - | - |
| <a name="module_contentful-source.ContentfulOptions+space">`space`</a> |  <code>string</code>| <span>Your Contentful space ID. Note that credentials.json will require an accessToken in addition to this</span> |
| <a name="module_contentful-source.ContentfulOptions+locale">`locale`</a> |  <code>string</code>| <span>Optional. Used to pull localized images. Defaults to &#x27;en-US&#x27;</span> |
| <a name="module_contentful-source.ContentfulOptions+filename">`filename`</a> |  <code>string</code>| <span>Optional. The filename you want to use for where all content (entries and assets metadata) will be stored. Defaults to &#x27;content.json&#x27;</span> |
| <a name="module_contentful-source.ContentfulOptions+contentTypes">`contentTypes`</a> |  <code>Array.&lt;string&gt;</code>| <span>Optionally limit queries to these content types.This will also apply to linked assets.Types that link to other types will include up to 10 levels of child content.E.g. filtering by Story, might also include Chapters and Images.Uses searchParams[&#x27;sys.contentType.sys.id[in]&#x27;] under the hood.</span> |
| <a name="module_contentful-source.ContentfulOptions+searchParams">`searchParams`</a> |  <code>Object</code>| <span>Optional. Supports anything from https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/search-parameters</span> |
| <a name="module_contentful-source.ContentfulOptions+imageParams">`imageParams`</a> |  <code>Object</code>| <span>Optional. Applies to all images. Defaults to empty object.IMPORTANT: If you change the parameters, you will have todelete all cached images since the modified date of theoriginal image will not have changed.</span> |
| <a name="module_contentful-source.ContentfulOptions+protocol">`protocol`</a> |  <code>string</code>| <span>Optional. Defaults to &#x27;https&#x27;.</span> |
| <a name="module_contentful-source.ContentfulOptions+host">`host`</a> |  <code>string</code>| <span>Optional. Defaults to &#x27;cdn.contentful.com&#x27;.</span> |
| <a name="module_contentful-source.ContentfulOptions+usePreviewApi">`usePreviewApi`</a> |  <code>boolean</code>| <span>Optional. Set to true if you want to use the preview API instead of the production version to view draft content. Defaults to false.</span> |
| <a name="module_contentful-source.ContentfulOptions+deliveryToken">`deliveryToken`</a> |  <code>string</code>| <span>Content delivery token (all published content).</span> |
| <a name="module_contentful-source.ContentfulOptions+previewToken">`previewToken`</a> |  <code>string</code>| <span>Content preview token (only unpublished/draft content).</span> |
| <a name="module_contentful-source.ContentfulOptions+accessToken">`accessToken`</a> |  <code>string</code>| <span>LEGACY: For backwards compatibility you can only set the &quot;accessToken&quot; using your delivery or preview token and a combination of the usePreviewApi flag.</span> |
