// 7 hours (4 hours Fri and 3 hours Sat)
var ripple_lib = require('ripple-lib').Remote;
var Worker = require('webworker-threads').Worker;

var events = require('events')
var eventEmitter = new events.EventEmitter();

var Q = require('q');
var fs = require('fs');
var request = require('request');
var async = require('async');
var _ = require('lodash');

var accounts = ['r4ffgYrACcB82bt99VnqH4B9GEntEypTcp', 'rUB4uZESnjSp2r7Uw1PnKSPWNMkTDCMXDJ', 'rBTC1BgnrukYh9gfE8uL5dqnPCfZXUxiho'];
var account_totals = [];

var remote = new ripple_lib({
    servers : ['wss://s1.ripple.com:443']
});

// Utlizing worker thread to handle large data set computationally without
// losing effeciency and taking advantage of CPU corse and evented node.js.
var total = new Worker(function(){
    function accountant(trust_lines){
        var totalSoFar = 0;
        for(var i = 0; i < trust_lines.length; i++){
            totalSoFar = totalSoFar + parseFloat(trust_lines[i]);
        }

       return totalSoFar;
    }

    this.onmessage = function(event){
        postMessage(accountant(event.data));
    };
});

var q = async.queue(function(account_id, callback){
    remote.connect(function(){
        // Options for account_info.
        var options = {
            account: account_id,
            ledger: 'validated'
        };

        var account = remote.requestAccountInfo(options, function(err, response){
            if(err){
                console.log("Error Log: " + err);
            }

            // Selecting needed information.
            balance_XRP = parseFloat(response.account_data.Balance);
            ledger_index = response.ledger_index;

            // Options for account_lines.
            var options = {
                account: account_id,
                ledger: ledger_index,
                limit: 500
                //Do I need a marker????
            };

            var trust_lines;
            remote.requestAccountLines(options, function(err, response){
                if(err){
                    console.log("Error Log: " + err);
                }

                trust_lines = response.lines;
                var it = 0;
                var url = '';
                var converted_trust_lines = [];
                var XRP_RATE = 1/0.0126;

                async.whilst(
                    function() { return it < trust_lines.length - 1; },
                    function(callback) {
                        // Converting currencies to USD then to XRP.
                        if(trust_lines[it].currency !== "XRP"){
                            url = "http://www.freecurrencyconverterapi.com/api/v3/convert?q=" + trust_lines[it].currency + "_USD&compact=y";
                            Q.nfcall(request.get, url)
                                .then(function(response){
                                    var data = JSON.parse(response[0].body);
                                    rate = 1/(_.valuesIn(data)[0].val);

                                    // Is XRP add to array of trustlines to be processed by worker.
                                    converted_trust_lines.push((parseFloat(trust_lines[it].balance) * rate) * XRP_RATE);
                                })
                                .catch(function(err){
                                    console.log("Error Log: " + err);
                                })
                                .done(function(){
                                   it++;
                                   setTimeout(callback, 1000);
                                });
                        }
                        else{
                            // Is XRP add to array of trustlines to be processed by worker.
                            converted_trust_lines.push(trust_lines[it].balance);
                        }
                    },
                    function(err) {
                        // Total the trust line balances with total XRP.
                        total.postMessage(converted_trust_lines);
                        total.onmessage = function(event){
                            var sum = event.data + balance_XRP;
                            var log = "This is the total for the account " + account_id + ": " + sum + ".";
                            console.log(log);

                            account_totals.push(sum);

                            // Signal event listener.
                            eventEmitter.emit('passed_sum');
                        };
                    }
                );
            });
        });
    });
    callback();
}, 1);

// Queue The accounts to be processed.
q.push(accounts, function(err){
    if(err){
        console.log(err);
    }
});

// Listen for each completed task returned from worker,
// log when all have completed.
eventEmitter.on('passed_sum', function(){
    if(account_totals.length == accounts.length){
        total.postMessage(account_totals);

        total.onmessage = function(event){
            var log = "This is the total across accounts: " + event.data;
            console.log(log);

        };
    }
});
