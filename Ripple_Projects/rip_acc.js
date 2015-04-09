// 9 hours (4 hours Fri and 3 hours Sat and Sun 1 hour and 1 hour testing Mon)
//
var ripple_lib = require('ripple-lib').Remote;
var Worker = require('webworker-threads').Worker;

// Events used to consolidate information from multiple processes running in parallel.
var events = require('events')
var eventEmitter = new events.EventEmitter();

// Main libraries utilized.
var Q = require('q');
var fs = require('fs');
var unirest = require('unirest');
var async = require('async');
var _ = require('lodash');

var account_totals = [];

// New Remote.
var remote = new ripple_lib({
    servers : ['wss://s1.ripple.com:443']
});
// Variable to dictate the number of concurrent processes to run.
var tasks = 1;

// Utlizing worker thread to handle large data set computationally without
// losing effeciency and taking advantage of CPU corse and evented node.js.
var total = new Worker(function(){
    function accountant(trust_lines){
        var totalSoFar = 0;
        for(var i = 0; i < trust_lines.length; i++){
            totalSoFar = totalSoFar + trust_lines[i];
        }

       return totalSoFar;
    }

    // Relay totals.
    this.onmessage = function(event){
        postMessage(accountant(event.data));
    };
});

// Queue in charge of parsing account informationa nd initiating worker above.
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
            var balance_XRP = parseFloat(response.account_data.Balance);
            var ledger_index = response.ledger_index;

            // Options for account_lines.
            var options = {
                account: account_id,
                ledger: ledger_index,
                limit: 500
                //Do I need a marker????
            };

            remote.requestAccountLines(options, function(err, response){
                if(err){
                    console.log("Error Log: " + err);
                }

                // Selecting needed information.
                var trust_lines = response.lines;
                var it = 0;
                var converted_trust_lines = [];

                async.whilst(
                    function() { return it < trust_lines.length - 1; },
                    function(callback) {
                        var url = "http://api.ripplecharts.com/api/exchange_rates";
                        var _request = {
                            pairs : [
                                {
                                    base    : { currency : trust_lines[it].currency, issuer : trust_lines[it].account },
                                    counter : { currency : "XRP" }
                                }
                            ]
                        };

                        // Converting currencies to XRP.
                        if(trust_lines[it].currency !== "XRP"){
                            unirest.post(url)
                            .headers({'Content-Type': 'application/json'})
                            .send(_request)
                            .end(function (response) {
                                if(typeof response.body !== undefined && response.body.length > 0){

                                    // Differentiate between currencies worth more and worth less in XRP value.
                                    if(response.body[0].rate > 0){
                                        rate = response.body[0].rate;
                                    }
                                    else{
                                        rate = 1/response.body[0].rate;
                                    }

                                    // Is XRP add to array of trustlines to be processed by worker.
                                    converted_trust_lines.push((parseFloat(trust_lines[it].balance) * rate));
                                }
                            });
                            it++;
                            setTimeout(callback, 1000);
                        }
                        else{
                            // Is XRP add to array of trustlines to be processed by worker.
                            converted_trust_lines.push(parseFloat(trust_lines[it].balance));
                        }
                    },
                    function(err) {
                        // Total the trustline balances with total XRP balance of given account.
                        total.postMessage(converted_trust_lines);
                        total.onmessage = function(event){
                            var sum = event.data + balance_XRP;
                            var log = "This is the total for the account " + account_id + ": \"" + sum + "\" XRP.";
                            console.log(log);

                            account_totals.push(sum);

                            // Signal event listener that a sum has been reached.
                            eventEmitter.emit('passed_sum');
                        };
                    }
                );
            });
        });
    });
    callback();
}, tasks);

// Listen for each completed task returned from workers,
// log when all sums have been completed.
eventEmitter.on('passed_sum', function(){
    if(account_totals.length == accounts.length){
        total.postMessage(account_totals);

        total.onmessage = function(event){
            var log = "This is the total across accounts: \"" + event.data + "\" XRP";
            console.log(log);
        };
    }
});

// Queue the accounts to be processed.

// Takes newline delimited file of accounts.
if(process.argv.length > 2){
    data = fs.readFileSync("./" + process.argv[2]);
    var accounts = data.toString().split("\n");
    accounts = accounts.slice(0, accounts.length - 1);
    tasks = accounts.length;

    // Add parsed accounts to queue.
    q.push(accounts, function(error){
        if(error){
            console.log(err);
        }
    });
}
else{
    // If no file is passed as first argument default behavior of "accountant".
    var accounts = ['r4ffgYrACcB82bt99VnqH4B9GEntEypTcp', 'rUB4uZESnjSp2r7Uw1PnKSPWNMkTDCMXDJ', 'rBTC1BgnrukYh9gfE8uL5dqnPCfZXUxiho'];

    // Add accounts to queue.
    q.push(accounts, function(err){
        if(err){
            console.log(err);
        }
    });
}


