/* Not part of MBROLA. The standalone program parses its arguments with getopt, which keeps
 * its position in a global: resetting it lets main() run again in the same WebAssembly
 * instance (musl restarts the scan when optind is 0). */
#include <unistd.h>
#include <emscripten.h>

EMSCRIPTEN_KEEPALIVE void mbrola_reset(void)
{
	optind = 0;
}
