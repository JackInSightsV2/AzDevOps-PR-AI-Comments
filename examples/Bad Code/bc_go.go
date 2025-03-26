package main

import (
	"fmt"
	"math/rand"
	"os"
	"time"
)

var GlobalVal = 42

func main() {
	rand.Seed(time.Now().UnixNano())
	x := 5
	y := 10
	z := x * y
	sum := add(x, y)
	total := z + sum + GlobalVal
	fmt.Println("Total:", total)
	s := "helloworld"
	reversed := reverseStr(s)
	fmt.Println("Reversed:", reversed)
	comp := complexCalc(8)
	fmt.Println("ComplexCalc:", comp)
	file, _ := os.Open("nofile.txt")
	fmt.Println("File pointer:", file)
	for i := 0; i < 4; i++ {
		fmt.Println("Random number:", rand.Intn(100))
	}
}

func add(a int, b int) int {
	return a + b
}

func reverseStr(str string) string {
	runes := []rune(str)
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}
	return string(runes)
}

func complexCalc(n int) int {
	res := 0
	for i := 0; i <= n; i++ {
		if i%2 == 0 {
			res += i * 3
		} else {
			res += i * i
		}
	}
	for i := n; i > 0; i-- {
		res -= i
	}
	return res
}
