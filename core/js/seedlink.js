// https://www.seiscomp3.org/doc/seattle/2012.279/apps/seedlink.html
// https://blog.freifunk.net/2017/06/26/choosing-spectrogram-visualization-library-javascript/
// https://ds.iris.edu/ds/products/seissound/
// https://ds.iris.edu/ds/support/faq/6/what-is-a-count-in-timeseries-data/
// http://www.lolisetriani.web.id/2015/06/macam-macam-gelombang-gempa-dan.html
// https://www.imv.co.jp/e/pr/seismic_monitoring/knowledge/
// http://eqseis.geosc.psu.edu/cammon/HTML/Classes/IntroQuakes/Notes/earthquake_size.html
// http://geofon.gfz-potsdam.de/fdsnws/station/1/query?network=GE&station=JAGI&level=resp&format=sc3ml
// https://github.com/crotwell/seisplotjs
var event = [];
var station = [];
var nama_db = "db_event";

// higher less accurate because less data sampel but faster processing and does not take much memory (sampleRate=20)
var MsSampel = 1000;
var MsMin = 10 * 1000;

var Gain = 1000000;
var amp_max = 3000;
var amp_min = -3000;

var line_start = 4 * 60 * 1000;
var line_end = 1 * 10 * 1000;

// every 1 seconds synchronizes all stations.
// make sure data received from proxy-seedlink also belongs to same value as this (HEARTBEAT_INTERVAL_MS).
var delayed_sync_data = 3000;

// if gai activity has increased, try analysis it
// https://en.wikipedia.org/wiki/Peak_ground_acceleration
var earthquake_come_soon = 0.0020;

// false when you are ready, gui is very useful when you are still debugging process but it is quite slow for analysis data.
var gui = true;
var gui_div = "auto";
var delayed_sync_render_gui = 3;
var gui_wait_tmp = 0;
var longbeep = 3;
var beep_volume = 0;
var uplot = true;
var debug = 1;
var logit = 10;
var reindex = false;

var seedlink = new ReconnectingWebSocket("wss://seedlink.volcanoyt.com");
seedlink.onopen = function (event) {
    seedlink.send(JSON.stringify({
        "subscribe": "GE.PLAI",
    }));
    /*
    seedlink.send(JSON.stringify({
        "subscribe": "II.KAPI",
    }));
    seedlink.send(JSON.stringify({
        "subscribe": "GE.JAGI",
    }));
*/
    if (gui)
        $('#isonline').html("Online");
};
seedlink.onmessage = function (eventt) {
    var json = JSON.parse(eventt.data);
    if (json.error) {
        console.error(json.error);
    } else if (json.success) {
        console.log(json.success);
    } else {
        Station(json);
    }
};
seedlink.onclose = function (eventt) {
    console.log("close", eventt);
};

//Get Index Time
function getDates(startDate, stopDate, ms = 0) {
    var dateArray = new Array();
    var currentDate = startDate;

    while (currentDate <= stopDate) {
        if (ms !== 0) {
            dateArray.push(Math.floor(currentDate) / ms);
        } else {
            dateArray.push(currentDate);
        }
        currentDate++;
    }
    return dateArray;
}

function Station(addsta) {
    var id = addsta.id;

    var start = addsta.start;
    var end = addsta.end;

    var sampel = addsta.data;
    var STA_SampleRate = addsta.sampleRate;

    //Data RAW
    var data_raw = [];
    var index_time = getDates(start, end);
    sampel.forEach((val, index) => {
        data_raw.push({
            x: index_time[index],
            y: val
        });
    });

    //cari station dulu
    var new_station = true;
    for (var j in station) {
        if (station[j].id == id) {
            new_station = false;

            station[j].sampel.raw = data_raw;
            station[j].sampel.end = end;
            station[j].sampel.start = start;

            break;
        }
    }

    //baru
    if (new_station) {

        station.push({
            id: id,

            input: start,

            sampel: {
                raw: data_raw,
                start: start,
                end: end,
                tmp: data_raw
            },

            config: {
                sampleRate: STA_SampleRate
            },

            primer: {
                start: start,
                end: end,
                sampel: []
            },

            secondary: {
                start: start,
                end: end,
                sampel: []
            },

            tgr: {
                start: start,
                end: end,
                cek: end,
                update: end,
            },

            tmp: {
                cek: start,
                chart: null
            }
        });
    }
}

//sync both stations so that they can pick up in real time later and maybe we can analyze data directly here
function sync() {

    var tnow = new Date().getTime();
    var go_start = tnow - line_start;
    var go_end = tnow + line_end;
    var total_line = go_end - go_start;

    if (logit >= 2)
        console.log(total_line);

    if (debug >= 20)
        debugger;

    var unlock_gui = false;
    if (gui) {
        if (gui_wait_tmp >= delayed_sync_render_gui) {
            gui_wait_tmp = 0;
            unlock_gui = true;
        } else {
            (gui_wait_tmp++) + (delayed_sync_data / 1000);
        }
    }

    for (var now in station) {
        var alwaysscan = true;
        var newdata = false;

        var count_secondary = 0;
        var count_primer = 0;
        var total_sampel_up = 0;
        var total_index_up = 0;

        var sta = station[now];

        var tmp_sampel = sta.sampel.tmp;
        var raw_sampel = sta.sampel.raw;
        var start_sampel = sta.sampel.start;
        var last_sampel_update = sta.sampel.end;
        var last_sampel_cek = sta.tmp.cek;

        var get_primer_start = sta.primer.start;
        var get_primer_end = sta.primer.end;
        var get_primer_sampel = sta.primer.sampel;

        var get_secondary_start = sta.secondary.start;
        var get_secondary_end = sta.secondary.end;
        var get_secondary_sampel = sta.secondary.sampel;

        //No RAW
        var noraw_data = [];

        console.log(last_sampel_update + " | " + last_sampel_cek);
        if (last_sampel_update !== last_sampel_cek) {
            newdata = true;

            //join tabel tmp dengan data baru (raw) lalu hapus data lama
            tmp_sampel = tmp_sampel.concat(raw_sampel);

            if (reindex) {
                /*
                            .filter(function (item) {
                                return go_start <= item.x
                            });
                            */

                //buat index baru for gui and etc
                //(1591683768169 - 1591683743969) / 100
                var index_noraw_time = getDates(go_start, go_end).sort(function (a, b) {
                    return b - a
                });

                //total
                total_sampel_up = tmp_sampel.length;
                total_index_up = index_noraw_time.length;

                // copy nilai ke index time baru
                for (var j in index_noraw_time) {
                    if (total_sampel_up > j) {

                        // console.log(index_noraw_time[j]+" < index | raw > "+tmp_sampel[j].x+' | pass > '+(Math.floor(index_noraw_time[j] / 1000) - Math.floor(tmp_sampel[j].x / 1000)) / 1000);
                        //   debugger;

                        noraw_data.push({
                            x: index_noraw_time[j],
                            y: tmp_sampel[j].y
                        });
                    } else {
                        break;
                    }
                };
            } else {
                noraw_data = tmp_sampel;
            }

            //update station
            station[now].sampel.tmp = noraw_data;
            station[now].tmp.cek = last_sampel_update;
        } else {
            //jika data masih lama jangan proses pakai yang sudah ada
            noraw_data = tmp_sampel;
        }

        //console.log("tmp_sampel", tmp_sampel);
        //console.log("noraw_data", noraw_data);

        tmp_sampel = null;

        // debugger;

        //last index (noraw_data)        
        var last_index = noraw_data[noraw_data.length - 1];
        var always_primer_start = last_index.x;
        var always_primer_end = last_index.x - MsMin;
        var first_index = noraw_data[0];
        var first_always_primer_start = first_index.x;
        var noalways_primer_start = first_index.x;
        var noalways_primer_end = first_index.x - MsMin;

        var delayed_in_ms = tnow - last_sampel_cek;
        var delayed_in_sec = Math.floor(delayed_in_ms / 1000);

        //raw data
        //var get_raw_index_first         = raw_sampel[0];
        //var get_raw_start_first         = get_raw_index_first.x;
        //var get_raw_index_last          = raw_sampel[raw_sampel.length - 1];
        //var select_last_start           = get_raw_index_last.x;
        //var get_raw_index_last_end      = get_raw_index_last.x + MsMin;

        //Hitung hanya data terbaru
        var data_select = [];
        raw_sampel.forEach((val) => {
            data_select.push(val.y);
            /*
            //Only Check       
            if (get_raw_start_first >= val.x && get_raw_index_last_end <= val.x) {                
            }
            */
        });

        //if (logit >= 4)
        //   console.log("data_select: ", data_select);

        //debugger;

        var GAL_raw = Math.max(...data_select);
        var GAL = (GAL_raw / Gain).toFixed(4);

        var total_sampel_raw = raw_sampel.length;
        var total_sampel_tmp = noraw_data.length;
        var total_data_select = data_select.length;

        //jika ada gempa base gain, TODO: use AI Mode
        var tgr_update = sta.tgr.update;
        //var tgr_cek = sta.tgr.cek;
        //var tgr_start = sta.tgr.start;

        if (logit >= 1)
            console.log(tnow + " | " + delayed_in_sec + " | " + always_primer_end + " | " + always_primer_start + " | " + tgr_update + " | " + last_sampel_cek + " | " + GAL);

        if (debug >= 12)
            debugger;

        //jika ada gempa
        if (GAL >= earthquake_come_soon) {

            //update tgr
            station[now].tgr.update = always_primer_start;
            station[now].tgr.cek = last_sampel_cek;

            if (tgr_update == last_sampel_cek) {
                //jika gempa awal
                console.log('ada');
                //get_secondary_start = get_primer_end;
                //station[now].secondary.start = get_primer_end;
                //get_secondary_end = always_primer_start;
                //station[now].secondary.end = always_primer_start;
            } else {
                console.log('lanjut');
                //jika gempa seterusnya
                //get_primer_start = select_last_start;
                //station[now].primer.start = select_first_always_primer_start;
                //get_primer_end = select_last_start;
                //station[now].primer.end = select_last_start;
            }

            count_secondary = get_secondary_end - get_secondary_start;
            count_primer = get_primer_end - get_primer_start;

            if (get_primer_start >= go_start && get_primer_end <= go_end) {
                alwaysscan = false;
            }

            if (get_secondary_start >= go_start && get_secondary_end <= go_end) {
                alwaysscan = false;
            }

        } else {
            //NO Gempa
        }

        console.log(count_secondary + " | " + count_primer);
        //debugger;

        //Update GUI
        if (unlock_gui) {

            var gui_y = earthquake_come_soon * Gain;

            /*
            if (!reindex) {

                //buat sampel tmp
                var sampel_tmp = [];

                var go_start_in_sec = Math.floor(go_start / 1000);
                var go_end_in_sec = Math.floor(go_end / 1000);

                var index_tmp_time = getDates(go_start_in_sec, go_end_in_sec);

                index_tmp_time.forEach((val, index) => {
                    sampel_tmp.push({
                        x: val,
                        y: null //getRndInteger(-10000, 10000) TODO: coba nilai rata-rata
                    })
                });
                index_tmp_time = null;

                //set real sampel val to sampel tmp
                for (var sr in noraw_data) {
                    for (var jt in sampel_tmp) {
                        if (Math.floor(noraw_data[sr].x / 1000) == sampel_tmp[jt].x) {
                            sampel_tmp[jt].y = noraw_data[sr].y;
                            //console.log('ada');
                            //debugger;
                            break;
                        }
                    };
                    //debugger;
                };

                //console.log("tes", noraw_data);
                //debugger;

                noraw_data = sampel_tmp;
            }
*/
            var info_pga = 'NO DATA';
            if (GAL >= 0) {
                info_pga = GAL + 'g (' + GAL_raw + ')';
            }

            var out = document.getElementById(gui_div);
            // update body
            var infobody =
                ('\
                 Time Start: ' + moment(start_sampel).format('DD/MM/YYYY HH:mm:ss') + ' Time End: ' + moment(last_sampel_update).format('DD/MM/YYYY HH:mm:ss') + ' LC <br>\
                 PGA: ' + info_pga + ' (' + moment(always_primer_start).format('DD/MM/YYYY HH:mm:ss') + ' Last Update) <br>\
                 Delayed: ' + delayed_in_sec + ' sec <br>\
                 Total Sampel: ' + total_sampel_tmp + ' - ' + total_sampel_raw + ' \
                ');

            var tb = sta.tmp.chart;
            if (tb == null) {
                //jika belum ada chart

                //buat dulu
                out.insertAdjacentHTML('beforeend',
                    '<div class="modal-content mb-3" id="' + sta.id + '">\
                     <div class="modal-header">\
                     <h5 class="modal-title" id="judul">' + sta.id + '</h5>\
                     </div>\
                     <div class="modal-body" id="body"><div id="subbody">' + infobody + '</div><div id="chart"></div></div>\
                    </div>\
                    ');

                //lalu input data chart
                var chart = new ApexCharts(document.getElementById(sta.id).querySelector('#chart'), {
                    series: [{
                        name: 'Ground Acceleration',
                        data: noraw_data
                    }],
                    chart: {
                        id: 'realtime',
                        height: 350,
                        type: 'line',
                        animations: {
                            enabled: false,
                        },
                        events: {
                            zoomed: function (chartContext, {
                                xaxis,
                                yaxis
                            }) {
                                //Select Map
                                var select_map = [];
                                (sta.sampel.tmp).forEach((val) => {
                                    //Only for pick up         
                                    if (val.x >= xaxis.min && val.x <= xaxis.max) {
                                        select_map.push(val);
                                    }
                                });
                                var event = {
                                    nama: sta.id,
                                    sampel: select_map,
                                    start: xaxis.min,
                                    end: xaxis.max,
                                    type: 1
                                };

                                CopyEvent(event);

                                select_map = null;
                                event = null;

                                //console.log(yaxis);
                                //console.log(chartContext);
                            }
                        }
                    },
                    dataLabels: {
                        enabled: false
                    },
                    tooltip: {
                        enabled: true,
                        x: {
                            show: false,
                        }
                    },
                    title: {
                        text: sta.id,
                        align: 'left'
                    },
                    yaxis: {
                        max: amp_max,
                        min: amp_min
                    },
                    xaxis: {
                        type: 'numeric',
                        labels: {
                            formatter: function (value, timestamp, index) {
                                return (Math.floor(new Date().getTime() / 1000) - Math.floor(timestamp / 1000))
                            }
                        },
                        tooltip: {
                            enabled: false
                        }
                    },
                });
                chart.render();

                //pust chart
                station[now].tmp.chart = chart;
                tb = chart;

            } else {
                tb.updateSeries([{
                    data: noraw_data
                }]);
            }

            // update body
            document.getElementById(sta.id).querySelector('#subbody').innerHTML = infobody;

            //input chart here
            if (tb !== null) {
                /*
                tb.updateOptions({
                    xaxis: {
                        min: go_start,
                        max: go_end,
                    }
                });
                */
                tb.clearAnnotations();
                tb.addXaxisAnnotation({
                    x: tnow,
                    strokeDashArray: 0,
                    borderColor: "#775DD0",
                    label: {
                        borderColor: "#775DD0",
                        style: {
                            color: "#fff",
                            background: "#775DD0"
                        },
                        text: "Time Now"
                    }
                });
                tb.addYaxisAnnotation({
                    y: gui_y,
                    borderColor: '#e3004d',
                    label: {
                        borderColor: '#e3004d',
                        style: {
                            color: '#fff',
                            background: '#e3004d'
                        },
                        text: 'Trigger'
                    }
                });

                if (alwaysscan) {
                    tb.addXaxisAnnotation({
                        x: always_primer_start,
                        x2: always_primer_end,
                        fillColor: '#B3F7CA',
                        label: {
                            text: 'Always Primer'
                        }
                    });
                } else {
                    if (count_secondary >= count_primer) {
                        tb.addXaxisAnnotation({
                            x: get_secondary_start,
                            x2: get_secondary_end,
                            fillColor: '#B3F7CA',
                            label: {
                                text: 'Secondary'
                            }
                        });
                    }
                    //hapus Primer jika waktu sudah lewat
                    tb.addXaxisAnnotation({
                        x: get_primer_start,
                        x2: get_primer_end,
                        fillColor: '#B3F7CA',
                        label: {
                            text: 'Primer'
                        }
                    });
                }

            }

        }
    };
};
setInterval(sync, delayed_sync_data);

function getRndInteger(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
}

//this func no blok it?
function CopyEvent(data) {
    localforage.getItem(nama_db).then(function (value) {
        //baru pertama kali?
        if (isEmpty(value)) {
            value = [];
        }
        value.push(data);
        localforage.setItem(nama_db, value);
    }).catch(function (err) {
        console.log("Error Copy Event", err);
    });
}

function ReadEvent() {
    localforage.getItem(nama_db).then(function (value) {
        // This code runs once the value has been loaded
        // from the offline store.
        if (!isEmpty(value)) {
            console.log(value);
        } else {
            console.log('hmm');
        }

    }).catch(function (err) {
        // This code runs if there were any errors
        //console.log(err);
    });
}

function ClearEvent() {
    localforage.removeItem(nama_db).then(function () {
        // Run this code once the key has been removed.
        console.log('Key is cleared!');
    }).catch(function (err) {
        // This code runs if there were any errors
        //console.log(err);
    });
}

//FOR TESTING
/**
 * Calculate the expected value
 */
function expectancy(arrayOfValues) {
    let sumTotal = function (previousValue, currentValue) {
        return previousValue + currentValue;
    };
    let u = arrayOfValues.reduce(sumTotal);
    // Assume each member carries an equal weight in expected value
    u = u / arrayOfValues.length;
    return u;
}

/**
 * Calculate consistency of the members in the vector
 * @param {Array<number>} The vector of members to inspect for similarity
 * @return {number} The percentage of members that are the same
 */
var similarity = function (arrayOfValues) {
    let sumTotal = function (previousValue, currentValue) {
        return previousValue + currentValue;
    };
    // Step 1: Calculate the mean value u
    let u = expectancy(arrayOfValues); // Calculate the average
    // Step 2: Calculate the standard deviation sig
    let sig = [];
    let N = 1 / arrayOfValues.length;

    for (let i = 0; i < arrayOfValues.length; i++) {
        sig.push(N * (arrayOfValues[i] - u) * (arrayOfValues[i] - u));
    }
    // This only works in mutable type, such as found in JavaScript, else sum it up
    sig = sig.reduce(sumTotal);
    // Step 3: Offset from 100% to get the similarity
    return 100 - sig;
}

function removeDuplicates(array) {
    return array.filter((a, b) => array.indexOf(a) === b)
};

//answer = similarity(ar1);