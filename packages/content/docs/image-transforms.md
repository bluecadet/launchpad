# Image Transforms

Launchpad Content can create derivative images using various transforms. Under the hood, Launchpad uses sharp. Each transform creates a copy of the original image, with `@<transforms>` appended to the filename, for example `@0.5x` for images scaled to 50%.

Original images will remain in the destination folder and derivatives are cached until the original image is updated or removed.

The `imageTransforms` property expects a list of settings that contain a *transform type* as key and *transform settings* as value. Each individual settings object corresponds to one derivative image. For example the following will create one `@scale0.5x_@blur_16` and one `@2560x1040_inside` derivative.

```json
{
  "imageTransforms": [
    {
      "scale": 0.5,
      "blur": 16
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
}
```

## Scale

Applies a proportional scale to width and height.

```json
{
  "imageTransforms": [
    {"scale": 0.5},
    {"scale": 0.25}
  ]
}
```

## Resize

Resizes images using all available parameters provided by sharp's [resize options](https://sharp.pixelplumbing.com/api-resize#parameters).

```json
{
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
}
```

## Blur

Applies a [blur](https://sharp.pixelplumbing.com/api-operation#blur) within the original bounds of the image (no padding is added).

```json
{
  "imageTransforms": [
    {
      "blur": 16
    }
  ]
}
```