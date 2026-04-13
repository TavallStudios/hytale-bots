import io.netty.bootstrap.Bootstrap;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.Channel;
import io.netty.channel.ChannelFuture;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.nio.NioDatagramChannel;
import io.netty.handler.codec.quic.QuicChannel;
import io.netty.handler.codec.quic.QuicClientCodecBuilder;
import io.netty.handler.codec.quic.QuicSslContext;
import io.netty.handler.codec.quic.QuicSslContextBuilder;
import io.netty.handler.codec.quic.QuicStreamChannel;
import io.netty.handler.codec.quic.QuicStreamType;
import io.netty.handler.ssl.util.InsecureTrustManagerFactory;
import io.netty.handler.ssl.util.SelfSignedCertificate;
import io.netty.util.concurrent.Future;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.security.cert.CertificateException;
import java.time.Instant;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class HytaleQuicStdioBridge {
    private static final int MAX_READ = 8192;

    private HytaleQuicStdioBridge() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("Usage: HytaleQuicStdioBridge <quic-host> <quic-port>");
            System.exit(2);
            return;
        }

        String quicHost = args[0];
        int quicPort = Integer.parseInt(args[1]);
        InetSocketAddress quicAddress = new InetSocketAddress(quicHost, quicPort);
        QuicSslContext sslContext = buildClientSslContext();

        NioEventLoopGroup eventLoopGroup = new NioEventLoopGroup(1);
        Channel udpChannel = null;
        QuicChannel quicChannel = null;
        QuicStreamChannel quicStream = null;
        AtomicBoolean closed = new AtomicBoolean(false);

        try {
            logInfo("Binding UDP for QUIC", quicAddress);
            ChannelFuture udpBindFuture = new Bootstrap()
                .group(eventLoopGroup)
                .channel(NioDatagramChannel.class)
                .handler(new QuicClientCodecBuilder()
                    .sslContext(sslContext)
                    .maxIdleTimeout(10_000, TimeUnit.MILLISECONDS)
                    .initialMaxData(10_000_000)
                    .initialMaxStreamDataBidirectionalLocal(1_000_000)
                    .initialMaxStreamDataBidirectionalRemote(1_000_000)
                    .initialMaxStreamsBidirectional(4)
                    .build())
                .bind(0);

            if (!udpBindFuture.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out binding UDP socket");
            }
            udpChannel = udpBindFuture.sync().channel();

            logInfo("Connecting QUIC", quicAddress);
            Future<QuicChannel> quicConnectFuture = QuicChannel.newBootstrap(udpChannel)
                .handler(new ChannelInboundHandlerAdapter())
                .streamHandler(new ChannelInboundHandlerAdapter())
                .remoteAddress(quicAddress)
                .connect();

            if (!quicConnectFuture.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out connecting to QUIC server");
            }
            quicChannel = quicConnectFuture.sync().getNow();
            if (quicChannel == null) {
                throw new IllegalStateException("QUIC connect failed without channel");
            }

            logInfo("Creating QUIC stream", quicAddress);
            Future<QuicStreamChannel> quicStreamFuture = quicChannel.createStream(
                QuicStreamType.BIDIRECTIONAL,
                new QuicToStdoutHandler(System.out, closed)
            );

            if (!quicStreamFuture.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out creating QUIC stream");
            }
            quicStream = quicStreamFuture.sync().getNow();
            if (quicStream == null) {
                throw new IllegalStateException("QUIC stream creation failed");
            }

            System.err.printf("[%s] QUIC_BRIDGE_READY host=%s port=%d%n", Instant.now(), quicHost, quicPort);
            System.err.flush();

            Thread stdinPump = new Thread(
                new StdinToQuicPump(System.in, quicStream, closed),
                "hytale-quic-stdio-pump"
            );
            stdinPump.setDaemon(true);
            stdinPump.start();

            quicStream.closeFuture().sync();
        } catch (Exception exception) {
            logError("QUIC stdio bridge failed", exception);
        } finally {
            closeChannel(quicStream);
            closeChannel(quicChannel);
            closeChannel(udpChannel);
            eventLoopGroup.shutdownGracefully().syncUninterruptibly();
        }
    }

    private static QuicSslContext buildClientSslContext() throws CertificateException {
        SelfSignedCertificate certificate = new SelfSignedCertificate("localhost");
        return QuicSslContextBuilder.forClient()
            .trustManager(InsecureTrustManagerFactory.INSTANCE)
            .keyManager(certificate.key(), null, certificate.cert())
            .applicationProtocols("hytale/2", "hytale/1")
            .build();
    }

    private static void closeChannel(Channel channel) {
        if (channel == null) {
            return;
        }
        try {
            channel.close().syncUninterruptibly();
        } catch (Exception ignored) {
        }
    }

    private static void logError(String label, Throwable cause) {
        System.err.printf("[%s] %s: %s%n", Instant.now(), label, cause.getMessage());
        cause.printStackTrace(System.err);
    }

    private static void logInfo(String label, InetSocketAddress address) {
        System.err.printf("[%s] %s host=%s port=%d%n", Instant.now(), label, address.getHostString(), address.getPort());
        System.err.flush();
    }

    private static final class StdinToQuicPump implements Runnable {
        private final InputStream stdin;
        private final QuicStreamChannel quicStream;
        private final AtomicBoolean closed;

        private StdinToQuicPump(InputStream stdin, QuicStreamChannel quicStream, AtomicBoolean closed) {
            this.stdin = stdin;
            this.quicStream = quicStream;
            this.closed = closed;
        }

        @Override
        public void run() {
            byte[] buffer = new byte[MAX_READ];
            try {
                int read;
                while (!closed.get() && (read = stdin.read(buffer)) >= 0) {
                    if (read == 0) {
                        continue;
                    }
                    byte[] payload = new byte[read];
                    System.arraycopy(buffer, 0, payload, 0, read);
                    quicStream.eventLoop().submit(() -> quicStream.writeAndFlush(Unpooled.wrappedBuffer(payload))).syncUninterruptibly();
                }
            } catch (Exception exception) {
                logError("STDIN to QUIC forwarding failed", exception);
            } finally {
                closed.set(true);
                quicStream.close().syncUninterruptibly();
            }
        }
    }

    private static final class QuicToStdoutHandler extends SimpleChannelInboundHandler<ByteBuf> {
        private final OutputStream stdout;
        private final AtomicBoolean closed;

        private QuicToStdoutHandler(OutputStream stdout, AtomicBoolean closed) {
            this.stdout = stdout;
            this.closed = closed;
        }

        @Override
        protected void channelRead0(ChannelHandlerContext ctx, ByteBuf msg) throws Exception {
            int readable = msg.readableBytes();
            if (readable <= 0) {
                return;
            }
            byte[] payload = new byte[readable];
            msg.readBytes(payload);
            stdout.write(payload);
            stdout.flush();
        }

        @Override
        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            closed.set(true);
            logError("QUIC to STDOUT forwarding failed", cause);
            ctx.close();
        }

        @Override
        public void channelInactive(ChannelHandlerContext ctx) throws Exception {
            closed.set(true);
            super.channelInactive(ctx);
        }

    }
}
