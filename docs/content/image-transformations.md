# Image Transformations

We are using the [Sharp npm package](https://www.npmjs.com/package/sharp) which provides a robust set of functions for image manipulation. More info on their api can be found in [sharp documentation](https://sharp.pixelplumbing.com/api-constructor). So far in launchpad we have implemented a few transformations listed below.

## scale:

Multiple the image be the given percentage. The given example would create 3 derivatives.

```json
"imageTransforms": [
  {"scale": 2.0},
  {"scale": 0.5},
  {"scale": 0.25}
]
```

## resize:

Resize images with specific params. More details can be found in the [sharp documentation](https://sharp.pixelplumbing.com/api-constructor)

width: pixels wide the resultant image should be.
height: pixels high the resultant image should be.
fit: how the image should be resized to fit both provided dimensions, one of `cover`, `contain`, `fill`, `inside` or `outside`. (optional, default `cover`)
withoutEnlargement: do not enlarge if the width or height are already less than the specified dimensions.

```json
"imageTransforms": [
  {
    "resize": {
      "width": 200,
      "height": 200,
      "fit": "inside"
    }
  },
  {
    "resize": {
      "width": 2560,
      "height": 1040,
      "fit": "inside",
      "withoutEnlargement": true
    }
  }
]
```
