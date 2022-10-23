
  $(document).ready(function() {
    $(".dropbtn").click(function() {
      $("#panel").slideDown("slow");

    });
  });


function calc() { 
    let ivalue = document.getElementById("price").value;
   let r = document.getElementById("percentage").value;
   
   let increase = ivalue * (1 + r/100);
   var n= increase;
 var rounded = Math.round((n+Number.EPSILON)*10000)/10000;
    console.log(rounded);
   
   document.getElementById("demo").innerHTML = "Your Tp Price for "+r +"% " +"gain should be at = " +rounded;
} 
   
function calc2() {
   let pr1 = document.getElementById("price1").value;
    let pr2 = document.getElementById("price2").value;
             
    let pincrease = ((pr2 - pr1)/pr1) * 100;
    var n= pincrease;
    var rounded = Math.round((n+Number.EPSILON)*100)/100;
    console.log(rounded);
    
    
    
    document.getElementById("demo2").innerHTML= "Percentage change = "+rounded +" %";
    }
function calc3() { 
    let ivalue2 = document.getElementById("price3").value;
   let r2 = document.getElementById("percentage2").value;
   
   let i2 = ivalue2 * (1 - r2/100);
   var n= i2;
   var rounded = Math.round((n+Number.EPSILON)*10000)/10000;
    console.log(rounded);
   
   document.getElementById("demo3").innerHTML = "Your SL Price at "+r2 +"% " +"Loss should be at = " +rounded;
} 
function calc4() {
     let Amt = document.getElementById("Amount1").value;
   let percent = document.getElementById("percent").value;
   
   let profit = Amt * (percent/100);
   var p =profit;
   p = p.toFixed(2);
   
   document.getElementById("demo4").innerHTML = "Your profit is = " +"$" +p;
   }

