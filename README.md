# README #

JS library for SAP Business One Service Layer API.

### How Install it ? ###
```
npm i b1-service-layer --save
```


### Usage ###

```js
const ServiceLayer = require("b1-service-layer")
```

Set your config object

```js
    var config = {
        "host": "http://<server>",
        "port": 50001,
        "version": "v2",
        "username": "b1User",
        "password": "b1Password",
        "company": "b1Database"
    }
```

Create a new service layer session

```javascript
   var sl = new ServiceLayer()
   await sl.createSession(config)
```



### Samples (with order object)

```js
/*Get an order by DocEntry*/
var absoluteEntry = 100
var order = await sl.get(`Orders(${absoluteEntry})`)

/*
return =>
{
   "@odata.context": "https://<server>:50000/b1s/v2/$metadata#Orders/$entity",
   "DocEntry": 100,
   "DocNum": 10,
   "DocType": "dDocument_Items",
   "HandWritten": "tNO",
   "Printed": "psNo",
   "DocDate": "2016-04-04",
   "DocDueDate": "2016-12-02",
   "CardCode": "customerCode",
   "CardName": "Be... } 

  OR (if error)
  { error: true, message: "error message" }  
*/

           
/*Get open orders by DocNum*/
var list = await sl.get("Orders?$filter=DocumentStatus eq  'bost_Open'")

/*
return =>
 {"@odata.context": "https://<server>:50000/b1s/v2/$metadata#Orders",
   "value": [
      {
         "DocEntry": 8050,
         "DocNum": 3715, ...
      },
      {
         "DocEntry": 8051,
         "DocNum": 3716, ...
      },
      ...
      ],
  "@odata.nextLink": "Orders?$filter=DocumentStatus%20eq%20%20%27bost_Open%27&$skip=20"
 }
      
  OR (if error)
  { error: true, message: "error message" }  
*/


/*Create new order*/
var data = {
    DocDate:'2020-01-01',
    CardCode:'customerCode1',
    DocumentLines: [
        {ItemCode:"1122-22", Quantity: 1}
    ],...
}
    
var newOrder = await sl.post("Orders", data)


/*Update new order*/
var data = {
    DocDueDate:'2020-02-01',
}
var newOrderUpdated = await sl.patch("Orders", data)

/*Get all order without pagination (@odata.nextLink) */
var allOrders = await sl.find("Orders")
var allOrders = await sl.find("Orders?$filter=DocumentStatus eq  'bost_Open'")
                
```





















