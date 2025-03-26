$A=5
$b=10
function Add-Numbers($x,$y){ return $x+$y }
$result=Add-Numbers $A $b
Write-Output "Result: $result"
$arr=@(1,2,3,4,5)
function Multiply-Array($input){
$output=@()
for($i=0;$i -lt $input.Count;$i++){
$output+=$input[$i]*2
}
return $output
}
$doubled=Multiply-Array $arr
Write-Output ("Doubled: " + ($doubled -join ", "))
if("1" -eq 1){
Write-Output "Loose equality true"
}else{
Write-Output "Loose equality false"
}
$hash=@{key1="value1";key2="value2"}
foreach($k in $hash.Keys){
Write-Output "Key: $k Value: $($hash[$k])"
}
$count=0
while($count -lt 3){
Write-Output "Count: $count"
$count++
}
function ToUpper($str){ return $str.ToUpper() }
Write-Output ("Uppercase: " + (ToUpper "hello"))
Start-Sleep -Seconds 1
Write-Output "Delayed output"
