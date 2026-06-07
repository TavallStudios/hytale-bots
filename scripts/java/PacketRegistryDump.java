import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

public final class PacketRegistryDump {
    private PacketRegistryDump() {
    }

    public static void main(String[] args) throws Exception {
        Class<?> registryClass = Class.forName("com.hypixel.hytale.protocol.PacketRegistry");
        Method allMethod = registryClass.getMethod("all");
        Method toServerMethod = registryClass.getMethod("getToServerPacketById", int.class);
        Method toClientMethod = registryClass.getMethod("getToClientPacketById", int.class);

        @SuppressWarnings("unchecked")
        Map<Integer, Object> byId = (Map<Integer, Object>) allMethod.invoke(null);
        List<Integer> ids = new ArrayList<>(byId.keySet());
        ids.sort(Comparator.naturalOrder());

        StringBuilder json = new StringBuilder();
        json.append("[\n");

        for (int index = 0; index < ids.size(); index += 1) {
            int id = ids.get(index);
            Object info = byId.get(id);
            Class<?> infoClass = info.getClass();

            Method idMethod = infoClass.getMethod("id");
            Method nameMethod = infoClass.getMethod("name");
            Method channelMethod = infoClass.getMethod("channel");
            Method typeMethod = infoClass.getMethod("type");
            Method fixedBlockSizeMethod = infoClass.getMethod("fixedBlockSize");
            Method maxSizeMethod = infoClass.getMethod("maxSize");
            Method compressedMethod = infoClass.getMethod("compressed");

            boolean toServer = toServerMethod.invoke(null, id) != null;
            boolean toClient = toClientMethod.invoke(null, id) != null;

            String direction;
            if (toServer && toClient) {
                direction = "Both";
            } else if (toServer) {
                direction = "ToServer";
            } else if (toClient) {
                direction = "ToClient";
            } else {
                throw new IllegalStateException("Packet id " + id + " is present in all() but not in directional maps");
            }

            Object channel = channelMethod.invoke(info);
            Object type = typeMethod.invoke(info);

            json.append("  {\n");
            json.append("    \"direction\": \"").append(escapeJson(direction)).append("\",\n");
            json.append("    \"channel\": \"").append(escapeJson(String.valueOf(channel))).append("\",\n");
            json.append("    \"id\": ").append(((Integer) idMethod.invoke(info)).intValue()).append(",\n");
            json.append("    \"name\": \"").append(escapeJson(String.valueOf(nameMethod.invoke(info)))).append("\",\n");
            json.append("    \"type\": \"").append(escapeJson(type instanceof Class<?> clazz ? clazz.getSimpleName() : String.valueOf(type))).append("\",\n");
            json.append("    \"fixedBlockSize\": ").append(((Integer) fixedBlockSizeMethod.invoke(info)).intValue()).append(",\n");
            json.append("    \"maxSize\": ").append(((Integer) maxSizeMethod.invoke(info)).intValue()).append(",\n");
            json.append("    \"compressed\": ").append(((Boolean) compressedMethod.invoke(info)).booleanValue()).append("\n");
            json.append("  }");
            if (index < ids.size() - 1) {
                json.append(",");
            }
            json.append("\n");
        }

        json.append("]\n");
        System.out.print(json);
    }

    private static String escapeJson(String value) {
        StringBuilder escaped = new StringBuilder(value.length() + 8);
        for (int index = 0; index < value.length(); index += 1) {
            char current = value.charAt(index);
            switch (current) {
                case '\\' -> escaped.append("\\\\");
                case '"' -> escaped.append("\\\"");
                case '\b' -> escaped.append("\\b");
                case '\f' -> escaped.append("\\f");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                default -> {
                    if (current < 0x20) {
                        escaped.append(String.format("\\u%04x", (int) current));
                    } else {
                        escaped.append(current);
                    }
                }
            }
        }
        return escaped.toString();
    }
}
