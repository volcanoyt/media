var wait = ms => new Promise((r, j) => setTimeout(r, ms))
async function updatecek() {
    $.ajax({
            method: "GET",
            dataType: "json",
            cache: false,
            url: "https://api.volcanoyt.com/camera/list.json",
        }).done(async function(c) {
            for (i in c.results) {
                var addme = c.results[i];
                var info = await get(addme);
                await wait(1000 * 15);
            };
            return updatecek();
        })
        .fail(async function(a) {
            console.log(a);
            await wait(1000 * 15);
            return updatecek();
        });
}

function get(addme) {
    return new Promise(resolve => {
        jQuery.ajax({
            url: "https://api.volcanoyt.com/timelapse/" + addme.id + "/raw.jpg",
            cache: false,
            xhr: function() {
                var xhr = new XMLHttpRequest();
                xhr.responseType = 'blob'
                return xhr;
            },
            success: async function(data) {
                var img = document.getElementById("AGCCTV0");
                var url = window.URL || window.webkitURL;
                img.src = url.createObjectURL(data);
                $('#namax').text(addme.name + " | ID Cam: " + addme.id);
                resolve(200);
            },
            error: function() {
                resolve(404);
            }
        });
    });
}

updatecek();