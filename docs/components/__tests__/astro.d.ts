declare module "*.astro" {
	const component: Parameters<
		import("astro/container").experimental_AstroContainer["renderToString"]
	>[0];
	export default component;
}
