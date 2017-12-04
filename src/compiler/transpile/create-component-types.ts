import { ComponentMeta, ComponentRegistry, MembersMeta, MemberMeta, BuildConfig } from '../../util/interfaces';
import { normalizePath } from '../util';
import { dashToPascalCase } from '../../util/helpers';
import { MEMBER_TYPE } from '../../util/constants';
import * as path from 'path';

const METADATA_MEMBERS_TYPED = [ MEMBER_TYPE.Prop, MEMBER_TYPE.PropMutable ];

export interface ImportData {
  [key: string]: Array<{
    localName: string;
    importName?: string;
  }>;
}

/**
 * Generate the component.d.ts file that contains types for all components
 * @param config the project build configuration
 * @param options compiler options from tsconfig
 */
export function generateComponentTypesFile(config: BuildConfig, cmpList: ComponentRegistry): [ string, string ] {
  let typeImportData: ImportData = {};
  const allTypes: { [key: string]: number } = {};
  let componentsFileContent =
`/**
 * This is an autogenerated file created by the Stencil build process.
 * It contains typing information for all components that exist in this project
 * and imports for stencil collections that might be configured in your stencil.config.js file
 */\n\n`;

  componentsFileContent = config.collections.reduce((finalString, compCollection) => {
    return finalString + `import '${compCollection.name}';\n\n`;
  }, componentsFileContent);

  const componentFileString = Object.keys(cmpList)
    .filter(moduleFileName => cmpList[moduleFileName] != null)
    .sort()
    .reduce((finalString, moduleFileName) => {
      const cmpMeta = cmpList[moduleFileName];
      const importPath = normalizePath(config.sys.path.relative(config.srcDir, moduleFileName)
          .replace(/\.(tsx|ts)$/, ''));

      typeImportData = updateReferenceTypeImports(typeImportData, allTypes, cmpMeta, moduleFileName, config);

      finalString +=
        `${createTypesAsString(cmpMeta, importPath)}\n`;

      return finalString;
    }, '');

  const typeImportString = Object.keys(typeImportData).reduce((finalString: string, filePath: string) => {

    const typeData = typeImportData[filePath];
    let importFilePath: string;
    if (config.sys.path.isAbsolute(filePath)) {
      importFilePath = normalizePath('./' +
        config.sys.path.relative(config.srcDir, filePath)
      ).replace(/\.(tsx|ts)$/, '');
    } else {
      importFilePath = filePath;
    }
    finalString +=
`import {
${typeData.map(td => {
  if (td.localName === td.importName) {
    return `  ${td.importName},`;
  } else {
    return `  ${td.localName} as ${td.importName},`;
  }
}).join('\n')}
} from '${importFilePath}';\n`;

    return finalString;
  }, '');

  componentsFileContent += typeImportString + componentFileString;
  const rootFilePath = config.sys.path.join(config.srcDir, 'components.d.ts');

  return [ rootFilePath, componentsFileContent ];
}


/**
 * Find all referenced types by a component and add them to the importDataObj and return the newly
 * updated importDataObj
 *
 * @param importDataObj key/value of type import file, each value is an array of imported types
 * @param cmpMeta the metadata for the component that is referencing the types
 * @param filePath the path of the component file
 * @param config general config that all of stencil uses
 */
function updateReferenceTypeImports(importDataObj: ImportData, allTypes: { [key: string]: number }, cmpMeta: ComponentMeta, filePath: string, config: BuildConfig) {
  config;

  function getIncrememntTypeName(name: string): string {
    if (allTypes[name] == null) {
      allTypes[name] = 1;
      return name;
    }

    allTypes[name] += 1;
    return `${name}${allTypes[name]}`;
  }

  return Object.keys(cmpMeta.membersMeta)
  .filter((memberName) => {
    const member: MemberMeta = cmpMeta.membersMeta[memberName];

    return METADATA_MEMBERS_TYPED.indexOf(member.memberType) !== -1 &&
      member.attribType.typeReferences;
  })
  .reduce((obj, memberName) => {
    const member: MemberMeta = cmpMeta.membersMeta[memberName];
    Object.keys(member.attribType.typeReferences).forEach(typeName => {
      var type = member.attribType.typeReferences[typeName];
      let importFileLocation: string;

      // If global then there is no import statement needed
      if (type.referenceLocation === 'global') {
        return;

      // If local then import location is the current file
      } else if (type.referenceLocation === 'local') {
        importFileLocation = filePath;

      } else if (type.referenceLocation === 'import') {
        importFileLocation = type.importReferenceLocation;
      }

      // If this is a relative path make it absolute
      if (importFileLocation.startsWith('.')) {
        importFileLocation =
          path.resolve(
            path.dirname(filePath),
            importFileLocation
          );
      }

      obj[importFileLocation] = obj[importFileLocation] || [];

      // If this file already has a reference to this type move on
      if (obj[importFileLocation].find(df => df.localName === typeName)) {
        return;
      }

      const newTypeName = getIncrememntTypeName(typeName);
      obj[importFileLocation].push({
        localName: typeName,
        importName: newTypeName
      });
    });

    return obj;
  }, importDataObj);
}

/**
 * Generate a string based on the types that are defined within a component.
 *
 * @param cmpMeta the metadata for the component that a type definition string is generated for
 * @param importPath the path of the component file
 */
export function createTypesAsString(cmpMeta: ComponentMeta, importPath: string) {
  const tagName = cmpMeta.tagNameMeta;
  const tagNameAsPascal = dashToPascalCase(cmpMeta.tagNameMeta);
  const interfaceName = `HTML${tagNameAsPascal}Element`;
  const jsxInterfaceName = `${tagNameAsPascal}Attributes`;
  const interfaceOptions = membersToInterfaceOptions(cmpMeta.membersMeta);
  (<MembersMeta>cmpMeta.membersMeta);

  return `
import {
  ${cmpMeta.componentClass} as ${dashToPascalCase(cmpMeta.tagNameMeta)}
} from './${importPath}';

declare global {
  interface ${interfaceName} extends ${tagNameAsPascal}, HTMLElement {
  }
  var ${interfaceName}: {
    prototype: ${interfaceName};
    new (): ${interfaceName};
  };
  interface HTMLElementTagNameMap {
    "${tagName}": ${interfaceName};
  }
  interface ElementTagNameMap {
    "${tagName}": ${interfaceName};
  }
  namespace JSX {
    interface IntrinsicElements {
      "${tagName}": JSXElements.${jsxInterfaceName};
    }
  }
  namespace JSXElements {
    export interface ${jsxInterfaceName} extends HTMLAttributes {
      ${Object.keys(interfaceOptions).map((key: string) => `${key}?: ${interfaceOptions[key]};`).join('\n      ')}
    }
  }
}
`;
}

function membersToInterfaceOptions(membersMeta: MembersMeta): { [key: string]: string } {
  const interfaceData = Object.keys(membersMeta)
    .filter((memberName) => {
      return METADATA_MEMBERS_TYPED.indexOf(membersMeta[memberName].memberType) !== -1;
    })
    .reduce((obj, memberName) => {
      const member: MemberMeta = membersMeta[memberName];
      obj[memberName] = member.attribType.text;

      return obj;
    }, <{ [key: string]: string }>{});

  return interfaceData;
}
