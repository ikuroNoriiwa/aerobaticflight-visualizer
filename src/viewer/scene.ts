import * as Cesium from 'cesium';

export function createViewer(container: HTMLElement) {
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
  const hasToken = Boolean(token);
  if (hasToken) Cesium.Ion.defaultAccessToken = token!;

  const viewer = new Cesium.Viewer(container, {
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    baseLayer: hasToken
      ? undefined
      : new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })),
    terrain: hasToken ? Cesium.Terrain.fromWorldTerrain() : undefined,
  });

  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.clock.shouldAnimate = false;
  return { viewer, hasToken };
}
