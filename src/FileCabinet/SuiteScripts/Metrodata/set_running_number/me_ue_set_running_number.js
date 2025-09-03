/**
 *@NApiVersion 2.1
 *@NScriptType UserEventScript
 */
define(["N/record", "N/query", "N/search"], function (record, query, search) {

    const DIGIT_RUNNING_NUMBER = 8;

    function addDigits(running_number) {

        let result = "";

        let add_digit_length = DIGIT_RUNNING_NUMBER - running_number.toString().length;

        for (let i = 0; i < add_digit_length; i++) {
            result += "0"
        }
        result += running_number.toString()
        return result
    }

    function generateRunningNumber(running_number, get_year, context) {

        let sql = ` SELECT 
                    	id,
                     	tranid,
                    	SUBSTR(tranid, instr(tranid, '/', -1) + 3) as running_number,
                    	EXTRACT(YEAR FROM trandate) as year
                    FROM transaction
                    where 
                        recordtype = 'check' and 
                        EXTRACT(YEAR FROM trandate) = ${get_year}
                    ORDER BY id DESC
                    FETCH NEXT 1 ROWS ONLY;`

        let sql_result = query.runSuiteQL(sql).asMappedResults();
        log.debug("sql_result.length",sql_result.length)
        log.debug("sql_result",sql_result)
        log.debug("date",get_year)

        let create_running_number;
        if (sql_result.length > 0) {
            create_running_number = context.type == "create"?running_number + addDigits(Number(sql_result[0].running_number)+1):running_number + addDigits(Number(sql_result[0].running_number))
        } else {
            create_running_number = running_number + addDigits(1)
        }

        return create_running_number
    }

    function beforeSubmit(context) {
        var loadRec = context.newRecord;

        if (context.type != "delete") {

            var recId = loadRec.id;

            // var loadRec = record.load({
            //     type: rec.type,
            //     id: recId,
            //     isDynamic: true,
            // })

            let get_date = loadRec.getText("trandate");

            let get_year = (get_date.split("/")[2]).substring(2);

            let get_subsidiary = loadRec.getValue("subsidiary");
            let get_subsidiary_suffix = search.lookupFields({
                type: "subsidiary",
                id: get_subsidiary,
                columns: ['tranprefix']
            });

            let set_tranid = `${get_subsidiary_suffix.tranprefix}/CHECK/${get_year}`

            let generate_running_number = generateRunningNumber(set_tranid, get_date.split("/")[2], context)
            // var getRecType = loadRec.getValue('recordType');
            // log.debug("type record", getRecType);
            // var getTransNumber = (loadRec.getValue('transactionnumber')).split("/")[2];
            // log.debug("getTransNumber", getTransNumber)

            var set_check = loadRec.setValue('tranid', generate_running_number);

            // loadRec.save()
        }


    }

    return {
        beforeSubmit: beforeSubmit
    }
});
