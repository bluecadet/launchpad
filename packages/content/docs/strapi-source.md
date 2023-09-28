# Strapi Source


##  StrapiOptions
Options for StrapiSource


| Property | Type | Default | Description |
| - | - | - | - |
| <a name="module_strapi-source.StrapiOptions+version">`version`</a> |  <code>&#x27;3&#x27;</code> \| <code>&#x27;4&#x27;</code>|  <code>'3'</code>  | Versions `3` and `4` are supported. |
| <a name="module_strapi-source.StrapiOptions+baseUrl">`baseUrl`</a> |  <code>string</code>|  | The base url of your Strapi CMS (with or without trailing slash). |
| <a name="module_strapi-source.StrapiOptions+queries">`queries`</a> |  <code>Array.&lt;(string\|StrapiObjectQuery)&gt;</code>|  <code>[]</code>  | Queries for each type of content you want to save. One per content type. Content will be stored  as numbered, paginated JSONs.<br>You can include all query parameters supported by Strapi.<br>You can also pass an object with a `contentType` and `params` property, where `params` is an object of query parameters. |
| <a name="module_strapi-source.StrapiOptions+limit">`limit`</a> |  <code>number</code>|  <code>100</code>  | Max number of entries per page. |
| <a name="module_strapi-source.StrapiOptions+maxNumPages">`maxNumPages`</a> |  <code>number</code>|  <code>-1</code>  | Max number of pages. Use the default of `-1` for all pages |
| <a name="module_strapi-source.StrapiOptions+pageNumZeroPad">`pageNumZeroPad`</a> |  <code>number</code>|  <code>0</code>  | How many zeros to pad each json filename index with. |
| <a name="module_strapi-source.StrapiOptions+identifier">`identifier`</a> |  <code>string</code>|  | Username or email. Should be configured via `./.env.local` |
| <a name="module_strapi-source.StrapiOptions+password">`password`</a> |  <code>string</code>|  | Should be configured via `./.env.local` |
| <a name="module_strapi-source.StrapiOptions+token">`token`</a> |  <code>string</code>|  | Can be used instead of identifer/password if you previously generated one. Otherwise this will be automatically generated using the identifier or password. |
