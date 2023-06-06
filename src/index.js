import { parseDiagramFromFile } from './drawioParser.js'
import * as GristApi from './gristApi.js'

export const parseDiagramAndSaveToGrist = async () => {

  const diagramData = parseDiagramFromFile('./mxGraphModel.xml')
  diagramData.map(({ EN }) => console.log(EN))

  console.log(diagramData[1])

  const gristTables = await GristApi.fetchTables()
  console.log(gristTables)

  // diagramData.forEach(classData => {
  //   const existedTable = gristTables.find(table => table.id === classData.EN)
  //   if (existedTable) {

  //   } else {

      
  //   }
  // })


  
  
  // const tableColumns = await GristApi.fetchColumns('METERING_DEVICES')
  // console.log(tableColumns)
  // const table2Columns = await GristApi.fetchColumns('METERING_DEVICE_MODELS')
  // console.log(table2Columns)
  const tableColumns = await GristApi.fetchColumns('AUTHOR')
  console.log(tableColumns)
  const table2Columns = await GristApi.fetchColumns('BOOK')
  console.log(table2Columns)
  const table3Columns = await GristApi.fetchColumns('CITY')
  console.log(table3Columns)

  debugger


  // const newTables = [
  //   {
  //     id: 'People',
  //     columns: [
  //       {
  //         id: 'pet',
  //         fields: {
  //           label: 'Pet'
  //         }
  //       },
  //       {
  //         id: 'popularity',
  //         fields: {
  //           label: 'Popularity ❤'
  //         }
  //       }
  //     ]
  //   }
  // ]

  // try {
  //   const result = await GristApi.addTables(newTables)
  // } catch (e) {
  //   console.error(e)
  // }

  const newColumns = [
    {
      id: 'Auth',
      fields: {
        type: 'Ref:AUTHOR',
        // type: 'Int',
        // visibleCol: 11
        visibleCol: 3
      }
    }
  ]

  try {
    // const result = await GristApi.addColumns('BOOK', newColumns)
  } catch (e) {
    console.error(e)
  }

  // debugger
}