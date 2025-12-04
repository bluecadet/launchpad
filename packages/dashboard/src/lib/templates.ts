import Handlebars from "handlebars";

export const pageTemplate = Handlebars.compile<{
	title: string;
	cssFiles?: string[];
	jsFiles?: string[];
}>(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{title}}</title>
    {{#each cssFiles}}
    <link rel="stylesheet" href="{{this}}" />
    {{/each}}
</head>
<body>
    {{#each jsFiles}}
    <script src="{{this}}"></script>
    {{/each}}
</body>
</html>
`);
