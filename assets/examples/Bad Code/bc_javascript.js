function sum(a,b){return a+b}
function multiply(a,b){return a*b}
var A=5
var b_val=10
var result=sum(A,b_val)*multiply(A,b_val)
console.log("Result: "+result)
var arr=[1,2,3,4,5]
function doubleArr(a){
var ret=[]
for(var i=0;i<a.length;i++){
ret.push(a[i]*2)
}
return ret
}
var doubled=doubleArr(arr)
console.log("Doubled: "+doubled.join(","))
if("1"==1){
console.log("Loose equality true")
}else{
console.log("Loose equality false")
}
var obj={key1:"value1",key2:"value2"}
for(var k in obj){
console.log("Key: "+k+" Value: "+obj[k])
}
var count=0
while(count<3){
console.log("Count: "+count)
count++
}
function toUpper(str){return str.toUpperCase()}
console.log("Uppercase: "+toUpper("hello"))
setTimeout(function(){console.log("Delayed output")},1000)
