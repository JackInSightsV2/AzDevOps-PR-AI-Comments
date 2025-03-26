import random, sys, math

globalValue = 100

def addNumbers(x,y):
    return x+y

def multiply(x,y):
    return x*y

def doubleArray(arr):
  result = []
  for i in range(len(arr)):
    result.append(arr[i] * 2)
  return result

def reverseString(s):
    rev = ""
    for ch in s:
      rev = ch + rev
    return rev

def complexCalc(n):
    total=0
    for i in range(n):
         total += (i*i - i)
    for j in range(n,0,-1):
         total -= j
    return total

x = 5
Y = 10
result = addNumbers(x,Y) * multiply(x,Y) + globalValue
print("Result:", result)

myList = [1,2,3,4,5]
doubled = doubleArray(myList)
print("Doubled:", doubled)

if "1" == 1:
    print("Loose equality true")
else:
    print("Loose equality false")

data = {"a": "apple", "b": "banana"}
for key in data:
  print("Key:", key, "Value:", data[key])

count=0
while count < 3:
    print("Count:", count)
    count += 1

print("Reversed:", reverseString("python"))
print("ComplexCalc:", complexCalc(10))

for i in range(3):
    print("Random:", random.randint(1,100))
