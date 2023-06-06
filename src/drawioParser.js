import fs from 'fs'
import { XMLParser, XMLBuilder, XMLValidator } from 'fast-xml-parser'

const STYLE_PARAM_DELIMETER = ';'
const STYLE_VALUE_DELIMETER = '='
const ATTR_PREFIX = '@_'
const TAG_PREFIX = '_'
const CLASS_TAG = TAG_PREFIX + 'класс'
const ATTR_TAG = TAG_PREFIX + 'атрибут'

const ATTR = {
  ID: 'id',
  PARENT: 'parent',
  TAGS: 'tags',
  STYLE: 'style',
  VALUE: 'value',
  LABEL: 'label',
  EN: 'EN',
  SOURCE: 'source',
  TARGET: 'target',
  COPY: TAG_PREFIX + 'копия'
}

const usefulAttr = new Set(Object.values(ATTR))

const parseStyle = (styleAsString) => (
  styleAsString.split(STYLE_PARAM_DELIMETER).map(item => {
    const [param, value] = item.split(STYLE_VALUE_DELIMETER)
    return { param, value }
  })
)

const parseXml = (xmlAsString) => new XMLParser({ ignoreAttributes: false }).parse(xmlAsString)

const getAttr = (value) => value.startsWith(ATTR_PREFIX) ? value.slice(ATTR_PREFIX.length) : undefined

const isUsefulAttr = (attr) => usefulAttr.has(attr)

const parseObjects = (parsedXmlTree) => {
  
  const parseTreeNode = (treeNode, acc) => {
    Object.entries(treeNode).forEach(([key, value]) => {
      const attr = getAttr(key)
      if (attr === undefined) {
        if (value instanceof Array) {
          value.forEach(item => parseTreeNode(item, acc))
        } else {
          parseTreeNode(value, acc)
        }
      } else {
        if (isUsefulAttr(attr)) {
          acc[attr] = attr === ATTR.STYLE ? parseStyle(value) : value ? value.trim() : value
        }
      }
    })
    return acc
  }

  const parseListOfTrees = (list) => list.map(item => parseTreeNode(item, {}))
    
  let parsedCells = parseListOfTrees(parsedXmlTree.mxGraphModel.root.mxCell)
  let parsedObjects = parseListOfTrees(parsedXmlTree.mxGraphModel.root.object)
  let parsedUserObjects = parseListOfTrees(parsedXmlTree.mxGraphModel.root.UserObject)

  // Ищем копии классов, запоминаем на что они ссылались и удаляем их
  const { filtered, originalId, usedIn } = parsedObjects.reduce((acc, item) => {
    item[ATTR.COPY] ? { ...acc, [item[ATTR.ID]]: { originalId: item[ATTR.COPY], parentOfCopy: item[ATTR.PARENT] } } : acc
    if (item[ATTR.COPY]) {
      acc.originalId[item[ATTR.ID]] = item[ATTR.COPY]
      acc.usedIn[item[ATTR.COPY]] = (acc.usedIn[item[ATTR.COPY]] || []).concat(item[ATTR.PARENT])
    } else {
      acc.filtered.push(item)
    }
    return acc
  }, { filtered: [], originalId: {}, usedIn: {} })
  parsedObjects = filtered;

  // Везде заменяем ссылки на копии ссылками на оригинальные классы, а также где использовалась копия (в каких группах\фичах)
  [...parsedCells, ...parsedObjects, ...parsedUserObjects].forEach(item => {
    [ATTR.PARENT, ATTR.SOURCE, ATTR.TARGET].forEach(key => {
      if (originalId[item[key]]) {
        item[key] = originalId[item[key]] || item[key]
      }
    })
    if (usedIn[item[ATTR.ID]]) {
      item.usedIn = usedIn[item[ATTR.ID]]
    }
  })

  const split = (list, func) => {
    const { result, rest } = list.reduce((acc, item, index, array) => {
      acc[func(item, index, array) ? 'result' : 'rest'].push(item)
      return acc
    }, { result: [], rest: [] })
    return [result, rest]
  }

  const [classes, _rest] = split(parsedObjects, (item) => item.tags === CLASS_TAG)
  const [attributes, restObjects] = split(_rest, (item) => item.tags === ATTR_TAG)

  if (restObjects.length > 0) {
    console.error('При парсинге диаграммы остались неучтенные объекты. Но результат это может не повлиять, но следует сообщить об этом разработчику парсера (telegram @deniszhelnerovich)')
  }

  // Исключаем промежуточные связи между атрибутами и классами
  const classesById = classes.reduce((acc, item) => (
    acc[item[ATTR.ID]] = item, acc
  ), {})
  const allObjectsById = {
    ...classesById, 
    ...[...parsedUserObjects, ...restObjects].reduce((acc, item) => (
      acc[item[ATTR.ID]] = item, acc
    ), {})
  }

  const getParentClass = (element, objects, mediators) => {
    const parent = objects[element[ATTR.PARENT]]
    if (parent) {
      if (parent[ATTR.TAGS] === CLASS_TAG) {
        return [parent, mediators]
      } else {
        return getParentClass(parent, objects, mediators.concat(parent))
      }
    } else {
      return [element, mediators]
    }
  }


  // const allObjectsById = { ...userObjectsById, ...objectsById }
  const allMediatorIds = new Set()

  attributes.forEach(item => {
    const [parentClass, mediators] = getParentClass(item, allObjectsById, [])
    if (parentClass[ATTR.ID] !== item[ATTR.ID] && parentClass[ATTR.ID] !== item[ATTR.PARENT] && parentClass[ATTR.TAGS] === CLASS_TAG) {
      item[ATTR.PARENT] = parentClass[ATTR.ID]
      mediators.forEach((mediator) => allMediatorIds.add(mediator[ATTR.ID]))
    }

    const classObject = classesById[item[ATTR.PARENT]]
    if (classObject) {
      classObject.attributes = (classObject.attributes || []).concat(item)
    } else {
      throw `Не найден класс на который ссылается атрибут ${item[ATTR.LABEL]}`
    }

    // const userObject = userObjectsById[item[ATTR.PARENT]]
    // if (userObject) {
    //   userObject[ATTR.PARENT]
    // }
  })

  parsedUserObjects = parsedUserObjects.filter(item => !allMediatorIds.has(item[ATTR.ID]))

  // classes

  // split(attributes, (item) => {
  //   userObjectsById[item[ATTR.PARENT]]
    
  // })

  //TODO: в атрибуты вставить связи

  return classes

}

export const parseDiagramFromFile = (filepath) => {
  const buffer = fs.readFileSync(filepath)
  const fileContent = buffer.toString()
  return parseObjects(parseXml(fileContent))
}
