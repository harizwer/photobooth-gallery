package my.photobooth.booth;

/** The raw USB pipe to the camera. Android's USB connection in the app, a fake camera in tests. */
interface UsbLink {
    /** Largest USB packet of the bulk endpoints (512 on USB 2.0). */
    int maxPacket();

    /** Biggest single read/write the link handles. */
    int maxTransfer();

    /** Sends bytes to the camera. Returns the number sent, or a negative number on failure. */
    int write(byte[] data, int len, int timeoutMs);

    /** Reads one USB transfer from the camera. Returns the number read, or a negative number on failure. */
    int read(byte[] buf, int len, int timeoutMs);

    /** Unblocks a stuck link (PTP device reset, clear stalled endpoints, drop leftover data). */
    void recover();
}
