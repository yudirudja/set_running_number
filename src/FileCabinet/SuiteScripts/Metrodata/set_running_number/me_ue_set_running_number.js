/**
 *@NApiVersion 2.1
 *@NScriptType UserEventScript
 */
define(["N/record", "N/query", "N/search", "N/format"], function (record, query, search, format) {

    const DIGIT_RUNNING_NUMBER = 8;

    function addDigits(running_number) {

        var result = "";

        var add_digit_length = DIGIT_RUNNING_NUMBER - running_number.toString().length;

        for (var i = 0; i < add_digit_length; i++) {
            result += "0"
        }
        result += running_number.toString()
        return result
    }

    function getDeletedTransaction(document_number, prefix, rec) {
        var sql = ` SELECT
                        SUBSTR(name, INSTR(name,'#')+1) as tranid,
                    	SUBSTR(name, INSTR(name,'/',-1)+3) as running_number,
                    FROM
                    	DeletedRecord
                    WHERE 
                    	recordTypeId like '${rec.type}' and
	                    SUBSTR(name, INSTR(name,'#')+1)  like '${document_number}'`
        var sql_result = query.runSuiteQL(sql).asMappedResults();

        if (sql_result.length > 0) {
            var running_number = Number(sql_result[0].running_number) + 1
            return prefix + addDigits(running_number)
        } else {
            return document_number
        }
    }

    function generateRunningNumber(prefix, get_year, context, rec) {

        // log.debug("rec", rec.type)
        var sql = ` SELECT 
                    	id,
                     	tranid,
                    	SUBSTR(tranid, instr(tranid, '/', -1) + 3) as running_number,
                    	EXTRACT(YEAR FROM trandate) as year
                    FROM transaction
                    where 
                        recordtype = '${rec.type}' and 
                        EXTRACT(YEAR FROM trandate) = ${get_year} and
                        tranid like '${prefix}%'
                    ORDER BY id DESC
                    FETCH NEXT 1 ROWS ONLY;`

        var sql_result = query.runSuiteQL(sql).asMappedResults();
        // log.debug("sql_result.length", sql_result.length)
        // log.debug("sql_result", sql_result)
        // log.debug("date", get_year)

        var create_running_number;
        if (sql_result.length > 0) {
            var running_number = Number(sql_result[0].running_number) + 1
            var doc_number = prefix + addDigits(running_number)
            create_running_number = context.type == "create" ? getDeletedTransaction(doc_number, prefix, rec) : context.oldRecord.getValue("tranid")
            // create_running_number = context.type == "create" ? prefix + addDigits(Number(sql_result[0].running_number) + 1) : context.oldRecord.getValue("tranid")
        } else {
            var doc_number = prefix + addDigits(1)
            create_running_number = context.type == "create" ? getDeletedTransaction(doc_number, prefix, rec) : context.oldRecord.getValue("tranid")
        }

        return create_running_number
    }

    function validateRunningNumber(doc_number, get_year, rec, context) {
        var sql = ` SELECT 
                    	tranid,
                    FROM transaction
                    where 
                    	recordtype = '${rec.type}' and 
                    	EXTRACT(YEAR FROM trandate) = ${get_year} and
	                    tranid = '${doc_number}'`

        if (context.type == "edit") {
            sql += `and id != ${rec.id}`
        }
        sql += `group by 
                    tranid`

        var sql_result = query.runSuiteQL(sql).asMappedResults();

        if (sql_result.length > 0) {
            throw `There Is A Duplicate Document Number of ${doc_number}`;

        }

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

            var get_date = loadRec.getValue("trandate");

            var formatted_date = format.format({
                value: get_date,
                type: format.Type.DATE
            });
            // log.debug("formatted_date", formatted_date)

            var get_year = (formatted_date.split("/")[2]).substring(2);

            var get_subsidiary = loadRec.getValue("subsidiary");
            var get_subsidiary_suffix = search.lookupFields({
                type: "subsidiary",
                id: get_subsidiary,
                columns: ['tranprefix']
            });

            var set_tranid = ``

            if (loadRec.type == "check") {
                set_tranid = `${get_subsidiary_suffix.tranprefix}WC/${get_year}`
            } else if (loadRec.type == "vendorpayment") {
                set_tranid = `${get_subsidiary_suffix.tranprefix}VB/${get_year}`
            } else if (loadRec.type == "vendorprepayment") {
                set_tranid = `${get_subsidiary_suffix.tranprefix}VP/${get_year}`
            } else if (loadRec.type == "vendorbill") {
                set_tranid = `${get_subsidiary_suffix.tranprefix}PI/${get_year}`
            } else if (loadRec.type == "vendorcredit") {
                set_tranid = `${get_subsidiary_suffix.tranprefix}DN/${get_year}`
            }

            var generate_running_number = generateRunningNumber(set_tranid, formatted_date.split("/")[2], context, loadRec)
            // var validate_running_number = validateRunningNumber(generate_running_number, formatted_date.split("/")[2], loadRec, context)
            // var getRecType = loadRec.getValue('recordType');
            // log.debug("type record", getRecType);
            // var getTransNumber = (loadRec.getValue('transactionnumber')).split("/")[2];
            // log.debug("getTransNumber", getTransNumber)

            var set_external_id = loadRec.setValue('externalid', generate_running_number);
            var set_check = loadRec.setValue('tranid', generate_running_number);

            // loadRec.save()
        }


    }

    function setExternalId(rec, running_number, prefix, attempt) {
        if (attempt > 10) {
            log.error("Max attempts reached", `Could not set external ID after 10 tries`);
            return;
        }

        try {
            const newId = `${prefix}/${running_number}`;
            log.debug("Trying external ID", newId);

            rec.setValue("tranid", newId);
            rec.setValue("externalid", newId);
            rec.save();

        } catch (e) {
            log.error("Duplicate or error saving", e.message);

            // Reload record fresh to avoid invalid reference
            const newRec = record.load({
                type: rec.type,
                id: rec.id
            });

            setExternalId(newRec, running_number + 1, prefix, attempt + 1);
        }
    }

    function afterSubmit(context) {
        if (context.type == "create" || context.type == "edit") {
            var loadRec = context.newRecord;

            log.debug("loadRec", loadRec)

            if (loadRec.id) {


                var rec = record.load({
                    type: loadRec.type,
                    id: loadRec.id,
                })

                var get_external_id = rec.getValue("externalid");
                var get_tran_id = rec.getValue("tranid");

                // log.debug("get_external_id", get_external_id)

                if (context.type == "create") {
                    var running_number = Number(get_tran_id.split("/")[1])
                    var prefix = get_tran_id.split("/")[0]
                    setExternalId(rec, running_number, prefix, 0)
                }
            }

        }

    }

    return {
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit,
    }
});
