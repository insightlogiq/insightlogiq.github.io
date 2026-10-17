var API_CONTRACT = {
  version: 1,
  operations: {
    getQuotation: {
      method: "GET",
      request: {
        quotationId: { type: "string" }
      },
      response: { required: ["quotation"] }
    },
    saveQuotation: {
      method: "POST",
      type: "quotation",
      request: {
        clientName: { type: "string" },
        sites: { type: "array", minItems: 1 },
        grandSubtotal: { type: "number" },
        discountAmount: { type: "number" },
        gstAmount: { type: "number" },
        total: { type: "number" }
      },
      response: { required: ["quotationId"] }
    },
    saveInvoice: {
      method: "POST",
      type: "invoice",
      request: {
        quotationId: { type: "string" },
        clientName: { type: "string" },
        invoiceDate: { type: "string" },
        sites: { type: "array", minItems: 1 },
        amount: { type: "number" },
        amountPaid: { type: "number" },
        balanceDue: { type: "number" },
        paymentMode: { type: "string", allowEmpty: true }
      },
      response: { required: ["invoiceId"] }
    }
  }
};

function sendResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function sendError(code, message) {
  return sendResponse({
    result: "error",
    error: { code: code, message: message }
  });
}

function createApiError(code, message) {
  var error = new Error(message);
  error.code = code;
  return error;
}

function validateContractVersion(version) {
  if (Number(version) !== API_CONTRACT.version) {
    throw createApiError(
      "CONTRACT_MISMATCH",
      "Client API contract version " + version + " does not match server version " + API_CONTRACT.version + "."
    );
  }
}

function respondWithError(error) {
  return sendError(error.code || "INTERNAL_ERROR", error.code ? error.message : "The server could not complete the request.");
}

function validateRequest(data, operationName) {
  var operation = API_CONTRACT.operations[operationName];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createApiError("INVALID_REQUEST", "Request body must be a JSON object.");
  }

  Object.keys(operation.request).forEach(function (field) {
    var rule = operation.request[field];
    var value = data[field];
    var validType = rule.type === "array"
      ? Array.isArray(value)
      : typeof value === rule.type;

    if (value === undefined || value === null || !validType || (rule.type === "number" && !isFinite(value))) {
      throw createApiError("INVALID_REQUEST", "Invalid or missing field: " + field + ".");
    }
    if (rule.type === "string" && !rule.allowEmpty && !value.trim()) {
      throw createApiError("INVALID_REQUEST", "Invalid or missing field: " + field + ".");
    }
    if (rule.minItems && value.length < rule.minItems) {
      throw createApiError("INVALID_REQUEST", field + " must contain at least " + rule.minItems + " item.");
    }
  });
}

function doPost(e) {
  var data;
  var operationName;

  try {
    data = JSON.parse(e && e.postData && e.postData.contents || "");
  } catch (error) {
    return sendError("INVALID_JSON", "Request body must contain valid JSON.");
  }

  try {
    validateContractVersion(data && data._contractVersion);
  } catch (error) {
    return respondWithError(error);
  }

  operationName = data && data.type === "quotation" ? "saveQuotation"
    : data && data.type === "invoice" ? "saveInvoice"
      : "";
  if (!operationName) {
    return sendError("UNKNOWN_OPERATION", "Request type must be quotation or invoice.");
  }

  try {
    validateRequest(data, operationName);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      return sendError("SERVER_BUSY", "Server busy. Please try again.");
    }

    try {
      return saveDocument(data, operationName);
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return respondWithError(error);
  }
}

function saveDocument(data, operationName) {
  var isQuotation = operationName === "saveQuotation";
  var sheetName = isQuotation ? "Quotations" : "Invoices";
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw createApiError("SHEET_NOT_FOUND", sheetName + " sheet not found.");
  }

  var now = new Date();
  var prefix = isQuotation ? "Q-" : "INV-";
  var newId = prefix + Utilities.formatDate(now, "GMT+5:30", "yyyyMMdd") + "-" + sheet.getLastRow();
  var storedData = Object.assign({}, data);
  delete storedData._contractVersion;
  var row = isQuotation
    ? [newId, now, data.clientName, data.sites.length, data.grandSubtotal, data.discountAmount, data.gstAmount, data.total, "", JSON.stringify(storedData)]
    : [newId, data.quotationId, data.invoiceDate, data.clientName, data.amount, data.amountPaid, data.balanceDue, data.paymentMode, "", "", JSON.stringify(storedData)];

  sheet.appendRow(row);
  return sendResponse(isQuotation
    ? { result: "success", quotationId: newId }
    : { result: "success", invoiceId: newId });
}

function doGet(e) {
  var parameters = e && e.parameter || {};
  var action = parameters.action || (parameters.quotationId ? "getQuotation" : "");

  if (action === "contract") {
    return sendResponse({ result: "success", contract: API_CONTRACT });
  }
  if (action !== "getQuotation") {
    return sendError("UNKNOWN_OPERATION", "Action must be contract or getQuotation.");
  }

  try {
    validateContractVersion(parameters._contractVersion);
    validateRequest(parameters, "getQuotation");
    return sendResponse({ result: "success", quotation: getQuotation(parameters.quotationId) });
  } catch (error) {
    return respondWithError(error);
  }
}

function getQuotation(quotationId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Quotations");
  if (!sheet) {
    throw createApiError("SHEET_NOT_FOUND", "Quotations sheet not found.");
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw createApiError("QUOTATION_NOT_FOUND", "No quotations found.");
  }

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  var rowIndex = ids.findIndex(function (row) {
    return row[0] === quotationId;
  });
  if (rowIndex < 0) {
    throw createApiError("QUOTATION_NOT_FOUND", "Quotation ID does not exist.");
  }

  var storedData = sheet.getRange(rowIndex + 2, 10).getValue();
  var quotationData;
  try {
    quotationData = typeof storedData === "string" ? JSON.parse(storedData) : storedData;
  } catch (error) {
    throw createApiError("INVALID_STORED_QUOTATION", "Stored quotation data is invalid.");
  }

  if (!quotationData || typeof quotationData !== "object" || Array.isArray(quotationData)) {
    throw createApiError("INVALID_STORED_QUOTATION", "Stored quotation data is missing or invalid.");
  }

  return Object.assign({}, quotationData, { quotationId: quotationId });
}
