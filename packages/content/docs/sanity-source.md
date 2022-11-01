# Sanity Source


##  SanityOptions
Options for SanitySource


| Property | Type | Default | Description |
| - | - | - | - |
| <a name="module_sanity-source.SanityOptions+apiVersion">`apiVersion`</a> |  <code>string</code>|  <code>'v2021-10-21'</code>  | API Version |
| <a name="module_sanity-source.SanityOptions+projectId">`projectId`</a> |  <code>string</code>|  | Sanity Project ID |
| <a name="module_sanity-source.SanityOptions+dataset">`dataset`</a> |  <code>string</code>|  <code>'production'</code>  | API Version |
| <a name="module_sanity-source.SanityOptions+useCdn">`useCdn`</a> |  <code>string</code>|  <code>false</code>  | `false` if you want to ensure fresh data |
| <a name="module_sanity-source.SanityOptions+baseUrl">`baseUrl`</a> |  <code>string</code>|  | The base url of your Sanity CMS (with or without trailing slash). |
| <a name="module_sanity-source.SanityOptions+queries">`queries`</a> |  <code>Array.&lt;string&gt;</code>|  |  |
| <a name="module_sanity-source.SanityOptions+limit">`limit`</a> |  <code>number</code>|  <code>100</code>  | Max number of entries per page. |
| <a name="module_sanity-source.SanityOptions+maxNumPages">`maxNumPages`</a> |  <code>number</code>|  <code>-1</code>  | Max number of pages. Use `-1` for all pages |
| <a name="module_sanity-source.SanityOptions+mergePages">`mergePages`</a> |  <code>boolean</code>|  | To combine paginated files into a single file. |
| <a name="module_sanity-source.SanityOptions+pageNumZeroPad">`pageNumZeroPad`</a> |  <code>number</code>|  <code>0</code>  | How many zeros to pad each json filename index with. |
| <a name="module_sanity-source.SanityOptions+appendCroppedFilenames">`appendCroppedFilenames`</a> |  <code>boolean</code>|  <code>true</code>  | If an image has a crop set within Sanity, this setting will append the cropped filename to each image object as `launchpad.croppedFilename`. Set this to `false` to disable this behavior. |
| <a name="module_sanity-source.SanityOptions+apiToken">`apiToken`</a> |  <code>string</code>|  | API Token defined in your sanity project. |
