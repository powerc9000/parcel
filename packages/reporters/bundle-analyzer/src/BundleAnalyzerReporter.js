// @flow strict-local

import type {Bundle, FilePath, PluginOptions, Stats} from '@parcel/types';

import invariant from 'assert';
import {Reporter} from '@parcel/plugin';
import {DefaultMap} from '@parcel/utils';
import path from 'path';
import nullthrows from 'nullthrows';

export default new Reporter({
  async report({event, options}) {
    if (
      event.type !== 'buildSuccess' ||
      process.env.PARCEL_BUNDLE_ANALYZER == null
    ) {
      return;
    }

    let bundlesByTarget: DefaultMap<
      string /* target name */,
      Array<Bundle>
    > = new DefaultMap(() => []);
    for (let bundle of event.bundleGraph.getBundles()) {
      bundlesByTarget.get(bundle.target.name).push(bundle);
    }

    let reportsDir = path.join(options.projectRoot, 'parcel-bundle-reports');
    await options.outputFS.mkdirp(reportsDir);

    await Promise.all(
      [...bundlesByTarget.entries()].map(async ([targetName, bundles]) => {
        return options.outputFS.writeFile(
          path.join(reportsDir, `${targetName}.html`),
          `
          <html>
            <head>
              <title>${targetName}</title>
              <style>
                body {
                  margin: 0;
                }

                .tooltip {
                  position: absolute;
                  top: 0;
                  left: 0;
                  transform: translateX(0) translateY(0);
                  padding: 20px;
                  background-color: rgba(255, 255, 255, 0.7);
                }

                .tooltip-content {
                  font-family: monospace;
                }

                .tooltip-content dl div {
                  display: flex;
                }

                .tooltip-title {
                  font-size: 18px;
                }
              </style>
              <script>
                ${await options.inputFS.readFile(
                  path.resolve(
                    __dirname,
                    '../client/vendor/foamtree/carrotsearch.foamtree.js'
                  ),
                  'utf8'
                )}
              </script>
              <script id="bundle-data" type="application/json">
                ${JSON.stringify(getBundleData(bundles, options), null, 2)}
              </script>
            </head>
            <body>
              <script>
                ${await options.inputFS.readFile(
                  path.resolve(__dirname, '../client/index.js'),
                  'utf8'
                )}
              </script>
            </body>
          </html>
        `
        );
      })
    );
  }
});

type BundleData = {|
  groups: Array<Group>
|};

function getBundleData(
  bundles: Array<Bundle>,
  options: PluginOptions
): BundleData {
  return {
    groups: bundles.map(bundle => getBundleNode(bundle, options))
  };
}

type File = {|
  basename: string,
  stats: Stats
|};
type DirMapValue = File | DirMap;
type DirMap = DefaultMap<FilePath, DirMapValue>;
let createMap: () => DirMap = () => new DefaultMap(() => createMap());

function getBundleNode(bundle: Bundle, options: PluginOptions) {
  let assets = [];
  bundle.traverseAssets(asset => {
    assets.push(asset);
  });

  let dirMap = createMap();
  for (let asset of assets) {
    let relativePath = path.relative(options.projectRoot, asset.filePath);
    let parts = relativePath.split(path.sep);
    let dirs = parts.slice(0, parts.length - 1);
    let basename = parts[parts.length - 1];

    let map = dirMap;
    for (let dir of dirs) {
      invariant(map instanceof DefaultMap);
      map = map.get(dir);
    }

    invariant(map instanceof DefaultMap);
    map.set(basename, {
      basename: path.basename(asset.filePath),
      stats: asset.stats
    });
  }

  return {
    label: nullthrows(bundle.name),
    weight: bundle.stats.size,
    groups: generateGroups(dirMap)
  };
}

type Group = {|
  label: string,
  weight: number,
  groups?: Array<Group>
|};

function generateGroups(dirMap: DirMap): Array<Group> {
  let groups = [];

  for (let [directoryName, contents] of dirMap) {
    if (contents instanceof DefaultMap) {
      let childrenGroups = generateGroups(contents);
      if (childrenGroups.length === 1) {
        let firstChild = childrenGroups[0];
        groups.push({
          ...firstChild,
          label: path.join(directoryName, firstChild.label)
        });
      } else {
        groups.push({
          label: directoryName,
          weight: childrenGroups.reduce(
            (acc, g) => acc + nullthrows(g.weight),
            0
          ),
          groups: childrenGroups
        });
      }
    } else {
      // file
      groups.push({
        label: contents.basename,
        weight: contents.stats.size
      });
    }
  }

  return groups;
}
