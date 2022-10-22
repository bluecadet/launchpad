# Airtable Source


## AirtableOptions Parameters
Options for AirtableSource
| Property | Type | Default | Description |
| - | - | - | - |
| <a name="module_airtable-source.AirtableOptions+baseId">`baseId`</a> |  <code>string</code>| <code></code>   | Airtable base ID. @see https://help.appsheet.com/en/articles/1785063-using-data-from-airtable#:~:text=To%20obtain%20the%20ID%20of,API%20page%20of%20the%20base. |
| <a name="module_airtable-source.AirtableOptions+defaultView">`defaultView`</a> |  <code>string</code>| <code>'Grid view'</code>   |  |
| <a name="module_airtable-source.AirtableOptions+tables">`tables`</a> |  <code>string</code>| <code>[]</code>   | The tables you want to fetch from |
| <a name="module_airtable-source.AirtableOptions+keyValueTables">`keyValueTables`</a> |  <code>string</code>| <code>[]</code>   | As a convenience feature, you can store tables listed here as key/value pairs. Field names should be "key" and "value". |
| <a name="module_airtable-source.AirtableOptions+endpointUrl">`endpointUrl`</a> |  <code>string</code>| <code>'https://api.airtable.com'</code>   | The API endpoint to use for Airtable |
| <a name="module_airtable-source.AirtableOptions+defaultView">`defaultView`</a> |  <code>string</code>| <code></code>   | The table view which to select for syncing by default |
| <a name="module_airtable-source.AirtableOptions+appendLocalAttachmentPaths">`appendLocalAttachmentPaths`</a> |  <code>boolean</code>| <code>true</code>   | Appends the local path of attachments to the saved JSON |
