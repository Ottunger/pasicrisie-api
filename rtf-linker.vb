Sub BatchConvertDocxToPDF()
  Dim objDoc As Document
  Dim strFile As String, strFolder As String
 
  'Initialization
  strFolder = "C:\Users\gma09\Desktop\linked\"
  strFile = Dir(strFolder & "*.rtf", vbNormal)
 
  'Precess each file in the file folder and convert them to pdf.
  While strFile <> ""
    Set objDoc = Documents.Open(FileName:=strFolder & strFile)
 
    objDoc.ExportAsFixedFormat _
      OutputFileName:=Replace(objDoc.FullName, ".rtf", ".pdf"), _
      ExportFormat:=wdExportFormatPDF, OpenAfterExport:=False, OptimizeFor:=wdExportOptimizeForPrint, _
      Range:=wdExportAllDocument, Item:=wdExportDocumentContent
 
    objDoc.Close
    strFile = Dir()
  Wend
End Sub
