$(document).ready(function(){

$.ajax({
url: "https://jsonplaceholder.typicode.com/users",
method: "GET",
success: function(data){

data.forEach(function(usuario){
$("#listaUsuarios").append(
"<li>" + usuario.name + "</li>"
);
});

},
error: function(){
$("#mensajeError").text("No se pudo obtener la información.");
}

});

});