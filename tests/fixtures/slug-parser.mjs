// A local parser whose failure looks like a missing board. The message includes
// HTTP 404 so scan classifies it as slug_gone and still has to print the
// parser-failure line.
process.stderr.write('HTTP 404 board missing\n');
process.exit(1);
