# Content Transforms

Launchpad can transform text in JSON files using various transforms. Nodes can be selected using [`jsonpath` syntax](https://www.npmjs.com/package/jsonpath#user-content-jsonpath-syntax).

For example, to transform markdown to html for all json nodes called `body`:

```json
{
	"content": {
		"contentTransforms": {
			"$..body": ["mdToHtml"]
		}
	}
}
```

This example transforms sanity text blocks to html:

```json
{
	"content": {
		"contentTransforms": {
			"$..*[?(@._type=='block')]": ["sanityToHtml"]
		}
	}
}
```

In theory, multiple transforms can be applied to the same nodes and will be processed in sequence, with the result of each previous node passed to the next.

## Available Transforms

- `mdToHtml`: Converts markdown to html
- `mdToHtmlSimplified`: Converts markdown to html, but uses `<b>` and `<i>` instead of `<strong>` and `<em>`
- `markdownToHtml`: Alias for `mdToHtml`
- `markdownToHtmlSimplified`: Alias for `mdToHtmlSimplified`
- `sanityToPlain`: Converts Sanity CMS text blocks to plain text
- `sanityToHtml`: Converts Sanity CMS text blocks to html
- `sanityToMd`: Converts Sanity CMS text blocks to markdown
- `sanityToMarkdown`: Alias for `sanityToMd`
